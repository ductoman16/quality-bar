import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";

/** @type {string[]} */
const temporaryDirectories = [];

/** @param {unknown} error */
function codedError(error) {
  assert.ok(error instanceof Error && "code" in error);
  return /** @type {Error & {code: string, cause?: unknown}} */ (error);
}

function temporaryDatabasePath() {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-sqlite-"));
  temporaryDirectories.push(directory);
  return join(directory, "quality-bar.sqlite3");
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("opens the durable core only with WAL, foreign keys, durable synchronization, integrity, and schema", () => {
  const core = openDurableCore(temporaryDatabasePath());

  assert.deepEqual(core.facts, {
    databaseVersion: core.facts.databaseVersion,
    foreignKeys: true,
    integrity: "ok",
    journalMode: "wal",
    schemaVersion: 53,
    synchronous: "full",
  });
  assert.match(core.facts.databaseVersion, /^\d+\.\d+\.\d+$/);

  core.close();
});

test("a durable fact is invisible to another connection until its transaction commits", () => {
  const databasePath = temporaryDatabasePath();
  const writer = openDurableCore(databasePath);

  writer.transaction((transaction) => {
    transaction.run(
      "CREATE TABLE transaction_visibility (fact TEXT PRIMARY KEY) STRICT",
    );
  });
  const reader = openDurableCore(databasePath);

  writer.transaction((transaction) => {
    transaction.run(
      "INSERT INTO transaction_visibility (fact) VALUES (?)",
      "committed-fact",
    );
    assert.equal(
      reader.get(
        "SELECT fact FROM transaction_visibility WHERE fact = ?",
        "committed-fact",
      ),
      undefined,
    );
  });

  assert.deepEqual(
    reader.get(
      "SELECT fact FROM transaction_visibility WHERE fact = ?",
      "committed-fact",
    ),
    { fact: "committed-fact" },
  );

  reader.close();
  writer.close();
});

test("rejects a database that cannot use WAL with the exact owning error", () => {
  assert.throws(
    () => openDurableCore(":memory:"),
    (error) => {
      const failure = codedError(error);
      assert.equal(failure.code, "wal_unavailable");
      assert.equal(failure.message, "SQLite journal mode is memory, not wal");
      return true;
    },
  );
});

test("rejects a corrupt database with the exact owning error", () => {
  const databasePath = temporaryDatabasePath();
  writeFileSync(databasePath, "not a SQLite database");

  assert.throws(
    () => openDurableCore(databasePath),
    (error) => {
      const failure = codedError(error);
      assert.equal(failure.code, "integrity_check_failed");
      assert.equal(failure.message, "SQLite database is not valid");
      return true;
    },
  );
});

test("rejects an incompatible schema with the exact owning error", () => {
  const databasePath = temporaryDatabasePath();
  const current = openDurableCore(databasePath);
  current.run("PRAGMA user_version = 54");
  current.close();

  assert.throws(
    () => openDurableCore(databasePath),
    (error) => {
      const failure = codedError(error);
      assert.equal(failure.code, "schema_invalid");
      assert.equal(
        failure.message,
        "SQLite schema version 54 is not supported",
      );
      return true;
    },
  );
});

test("accepts an existing valid v53 database without changing its data", () => {
  const databasePath = temporaryDatabasePath();
  const created = openDurableCore(databasePath);
  created.run(
    "INSERT INTO quality_bar_metadata (key, value) VALUES (?, ?)",
    "preserved",
    "yes",
  );
  created.close();

  const reopened = openDurableCore(databasePath);
  assert.equal(
    reopened.get(
      "SELECT value FROM quality_bar_metadata WHERE key = ?",
      "preserved",
    )?.value,
    "yes",
  );
  reopened.close();
});

test("rejects nonempty version 0 before changing its objects", () => {
  const databasePath = temporaryDatabasePath();
  const database = new DatabaseSync(databasePath);
  database.exec("CREATE TABLE unsupported (value TEXT) STRICT");
  database.close();

  assert.throws(
    () => openDurableCore(databasePath),
    (error) => {
      const failure = codedError(error);
      assert.equal(failure.code, "schema_invalid");
      assert.equal(
        failure.message,
        "SQLite schema version 0 contains unsupported objects",
      );
      return true;
    },
  );
  const unchanged = new DatabaseSync(databasePath, {
    readOnly: true,
  });
  assert.equal(
    unchanged
      .prepare("SELECT name FROM sqlite_schema WHERE name = 'unsupported'")
      .get()?.name,
    "unsupported",
  );
  unchanged.close();
});

test("rejects a schema below v53 before changing its data", () => {
  const databasePath = temporaryDatabasePath();
  const created = openDurableCore(databasePath);
  created.run(
    "INSERT INTO quality_bar_metadata (key, value) VALUES (?, ?)",
    "preserved",
    "yes",
  );
  created.run("PRAGMA user_version = 52");
  created.close();

  assert.throws(
    () => openDurableCore(databasePath),
    (error) => {
      assert.equal(
        codedError(error).message,
        "SQLite schema version 52 is not supported",
      );
      return true;
    },
  );
  const unchanged = new DatabaseSync(databasePath, { readOnly: true });
  assert.equal(
    unchanged
      .prepare("SELECT value FROM quality_bar_metadata WHERE key = 'preserved'")
      .get()?.value,
    "yes",
  );
  assert.equal(
    unchanged.prepare("PRAGMA user_version").get()?.user_version,
    52,
  );
  unchanged.close();
});

test("rejects malformed v53 before repairing it", () => {
  const databasePath = temporaryDatabasePath();
  const created = openDurableCore(databasePath);
  created.run("DROP TABLE onboarding_tokens");
  created.close();

  assert.throws(
    () => openDurableCore(databasePath),
    (error) => {
      assert.equal(
        codedError(error).message,
        "SQLite schema table onboarding_tokens is missing",
      );
      return true;
    },
  );
  const unchanged = new DatabaseSync(databasePath, { readOnly: true });
  assert.equal(
    unchanged
      .prepare(
        "SELECT name FROM sqlite_schema WHERE name = 'onboarding_tokens'",
      )
      .get(),
    undefined,
  );
  unchanged.close();
});

test("a durable write failure enters the hard storage_unavailable gate", () => {
  /** @type {(Error & {code: string})[]} */
  const failures = [];
  const core = openDurableCore(temporaryDatabasePath(), {
    onStorageUnavailable(error) {
      failures.push(error);
    },
  });
  core.run("PRAGMA query_only = ON");

  assert.throws(
    () =>
      core.transaction((transaction) => {
        transaction.run(
          "INSERT INTO quality_bar_metadata (key, value) VALUES (?, ?)",
          "write_failure",
          "must-not-exist",
        );
      }),
    (error) => {
      const failure = codedError(error);
      assert.equal(failure.code, "storage_unavailable");
      assert.equal(failure.message, "SQLite durable write failed");
      return true;
    },
  );
  assert.equal(failures.length, 1);
  assert.equal(failures[0].code, "storage_unavailable");
  assert.throws(
    () =>
      core.get(
        "SELECT value FROM quality_bar_metadata WHERE key = ?",
        "schema_version",
      ),
    (error) => {
      assert.equal(codedError(error).code, "storage_unavailable");
      return true;
    },
  );

  core.close();
});

test("a locked durable write enters the hard storage_unavailable gate", () => {
  const databasePath = temporaryDatabasePath();
  const lockOwner = openDurableCore(databasePath);
  const blockedWriter = openDurableCore(databasePath);

  lockOwner.transaction(() => {
    assert.throws(
      () =>
        blockedWriter.transaction((transaction) => {
          transaction.run(
            "INSERT INTO quality_bar_metadata (key, value) VALUES (?, ?)",
            "blocked_write",
            "must-not-exist",
          );
        }),
      (error) => {
        assert.equal(codedError(error).code, "storage_unavailable");
        return true;
      },
    );
  });

  blockedWriter.close();
  lockOwner.close();
});

test("surfaces both the transaction error and a failed rollback", () => {
  const core = openDurableCore(temporaryDatabasePath());
  const transactionFailure = new Error("transaction failed");

  assert.throws(
    () =>
      core.transaction((transaction) => {
        transaction.run("ROLLBACK");
        throw transactionFailure;
      }),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(
        error.message,
        "SQLite transaction and rollback both failed",
      );
      assert.equal(error.errors[0], transactionFailure);
      assert.match(error.errors[1].message, /cannot rollback/);
      return true;
    },
  );

  core.close();
});

test("preserves a failed rollback on the hard storage_unavailable error", () => {
  const core = openDurableCore(temporaryDatabasePath());

  assert.throws(
    () =>
      core.transaction((transaction) => {
        transaction.run("PRAGMA query_only = ON");
        transaction.run("ROLLBACK");
        transaction.run(
          "INSERT INTO quality_bar_metadata (key, value) VALUES (?, ?)",
          "write_failure",
          "must-not-exist",
        );
      }),
    (error) => {
      const failure = codedError(error);
      assert.equal(failure.code, "storage_unavailable");
      assert.ok(failure.cause instanceof AggregateError);
      assert.match(failure.cause.errors[0].message, /readonly database/);
      assert.match(failure.cause.errors[1].message, /cannot rollback/);
      return true;
    },
  );

  core.close();
});
