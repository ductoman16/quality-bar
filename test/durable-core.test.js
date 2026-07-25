import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";

const temporaryDirectories = [];

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
    schemaVersion: 1,
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
      assert.equal(error.code, "wal_unavailable");
      assert.equal(error.message, "SQLite journal mode is memory, not wal");
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
      assert.equal(error.code, "integrity_check_failed");
      assert.equal(error.message, "SQLite database is not valid");
      return true;
    },
  );
});

test("rejects an incompatible schema with the exact owning error", () => {
  const databasePath = temporaryDatabasePath();
  const current = openDurableCore(databasePath);
  current.run("PRAGMA user_version = 2");
  current.close();

  assert.throws(
    () => openDurableCore(databasePath),
    (error) => {
      assert.equal(error.code, "schema_invalid");
      assert.equal(error.message, "SQLite schema version 2 is not supported");
      return true;
    },
  );
});

test("a durable write failure enters the hard storage_unavailable gate", () => {
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
      assert.equal(error.code, "storage_unavailable");
      assert.equal(error.message, "SQLite durable write failed");
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
      assert.equal(error.code, "storage_unavailable");
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
        assert.equal(error.code, "storage_unavailable");
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
      assert.equal(error.message, "SQLite transaction and rollback both failed");
      assert.equal(error.errors[0], transactionFailure);
      assert.match(error.errors[1].message, /cannot rollback/);
      return true;
    },
  );

  core.close();
});
