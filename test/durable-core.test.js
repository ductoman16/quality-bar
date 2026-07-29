import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { CODEX_CAPABILITY_CATALOG } from "../src/codex-capabilities.js";
import { openDurableCore } from "../src/durable-core.js";
import { createSystemResource } from "../src/system-resource.js";

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
    schemaVersion: 35,
    synchronous: "full",
  });
  assert.match(core.facts.databaseVersion, /^\d+\.\d+\.\d+$/);

  core.close();
});

test("migrates the existing operator-password schema atomically before serving sessions", () => {
  const databasePath = temporaryDatabasePath();
  const core = openDurableCore(databasePath);
  core.run("DROP INDEX authority_attributions_keyset");
  core.run("DROP TABLE authority_attributions");
  core.run("DROP TABLE browser_sessions");
  core.run(
    "UPDATE quality_bar_metadata SET value = '1' WHERE key = 'schema_version'",
  );
  core.run("PRAGMA user_version = 1");
  core.close();

  const migrated = openDurableCore(databasePath);
  assert.equal(migrated.facts.schemaVersion, 35);
  assert.equal(
    migrated.get(
      "SELECT value FROM quality_bar_metadata WHERE key = 'schema_version'",
    )?.value,
    "35",
  );
  migrated.run(
    "INSERT INTO browser_sessions (session_hash, csrf_hash, created_at, last_authenticated_at) VALUES (?, ?, ?, ?)",
    "session-hash",
    "csrf-hash",
    1,
    1,
  );
  migrated.close();
});

test("migrates legacy browser sessions by revoking records without lifetime timestamps", () => {
  const databasePath = temporaryDatabasePath();
  const core = openDurableCore(databasePath);
  core.transaction((transaction) => {
    transaction.run("DROP INDEX authority_attributions_keyset");
    transaction.run("DROP TABLE authority_attributions");
    transaction.run("DROP TABLE browser_sessions");
    transaction.run(
      "CREATE TABLE browser_sessions (session_hash TEXT PRIMARY KEY) STRICT",
    );
    transaction.run(
      "INSERT INTO browser_sessions (session_hash) VALUES (?)",
      "legacy-session-hash",
    );
    transaction.run(
      "UPDATE quality_bar_metadata SET value = '2' WHERE key = 'schema_version'",
    );
    transaction.run("PRAGMA user_version = 2");
  });
  core.close();

  const migrated = openDurableCore(databasePath);
  assert.equal(migrated.facts.schemaVersion, 35);
  assert.equal(
    migrated.get("SELECT session_hash FROM browser_sessions"),
    undefined,
  );
  migrated.close();
});

test("migrates v4 to v35 without losing existing authority facts", () => {
  const databasePath = temporaryDatabasePath();
  const core = openDurableCore(databasePath);
  core.transaction((transaction) => {
    transaction.run(
      "INSERT INTO browser_sessions (session_hash, csrf_hash, created_at, last_authenticated_at) VALUES (?, ?, ?, ?)",
      "retained-session-hash",
      "retained-csrf-hash",
      1,
      1,
    );
    transaction.run("DROP INDEX authority_attributions_keyset");
    transaction.run("DROP TABLE authority_attributions");
    transaction.run(
      "UPDATE quality_bar_metadata SET value = '4' WHERE key = 'schema_version'",
    );
    transaction.run("PRAGMA user_version = 4");
  });
  core.close();

  const migrated = openDurableCore(databasePath);
  assert.equal(migrated.facts.schemaVersion, 35);
  assert.deepEqual(migrated.get("SELECT session_hash FROM browser_sessions"), {
    session_hash: "retained-session-hash",
  });
  assert.equal(
    migrated.get(
      "SELECT value FROM quality_bar_metadata WHERE key = 'schema_version'",
    )?.value,
    "35",
  );
  assert.deepEqual(
    migrated.get(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'authority_attributions'",
    ),
    { name: "authority_attributions" },
  );
  assert.deepEqual(
    migrated.get(
      "SELECT name FROM sqlite_schema WHERE type = 'index' AND name = 'authority_attributions_keyset'",
    ),
    { name: "authority_attributions_keyset" },
  );
  assert.deepEqual(
    migrated.get(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'github_repository_polls'",
    ),
    { name: "github_repository_polls" },
  );
  migrated.close();
});

test("migrates the v23 Evaluation schema to durable Review Run admission", () => {
  const databasePath = temporaryDatabasePath();
  const current = openDurableCore(databasePath);
  current.transaction((transaction) => {
    transaction.run("DROP TRIGGER review_hard_delete_lineage");
    transaction.run("DROP TABLE codex_execution_queue");
    transaction.run("DROP TABLE review_runs");
    transaction.run(
      "UPDATE quality_bar_metadata SET value = '23' WHERE key = 'schema_version'",
    );
    transaction.run("PRAGMA user_version = 23");
  });
  current.close();

  const migrated = openDurableCore(databasePath);
  assert.equal(migrated.facts.schemaVersion, 35);
  assert.deepEqual(
    migrated.all(
      `SELECT name FROM sqlite_schema
       WHERE type = 'table'
         AND name IN ('review_runs', 'codex_execution_queue')
       ORDER BY name`,
    ),
    [{ name: "codex_execution_queue" }, { name: "review_runs" }],
  );
  migrated.close();
});

test("System facts exclude browser sessions past their idle or absolute lifetime", () => {
  const core = openDurableCore(temporaryDatabasePath());
  const now = Date.parse("2026-07-25T12:00:00.000Z");
  core.run(
    "INSERT INTO browser_sessions (session_hash, csrf_hash, created_at, last_authenticated_at) VALUES (?, ?, ?, ?)",
    "active-session",
    "active-csrf",
    now - 29 * 24 * 60 * 60 * 1_000,
    now - 6 * 24 * 60 * 60 * 1_000,
  );
  core.run(
    "INSERT INTO browser_sessions (session_hash, csrf_hash, created_at, last_authenticated_at) VALUES (?, ?, ?, ?)",
    "expired-session",
    "expired-csrf",
    now - 31 * 24 * 60 * 60 * 1_000,
    now - 8 * 24 * 60 * 60 * 1_000,
  );
  const system = createSystemResource(core, { now: () => now });
  const facts = system.readFacts({
    browserSessions: { isBootstrapped: () => true },
    codex: { status: "available" },
    implementerToken: { status: "revoked" },
    storage: { status: "available" },
  });
  assert.equal(facts.browser_sessions.active_count, 1);
  assert.deepEqual(facts.codex.catalog, CODEX_CAPABILITY_CATALOG);
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
  current.run("PRAGMA user_version = 36");
  current.close();

  assert.throws(
    () => openDurableCore(databasePath),
    (error) => {
      const failure = codedError(error);
      assert.equal(failure.code, "schema_invalid");
      assert.equal(
        failure.message,
        "SQLite schema version 36 is not supported",
      );
      return true;
    },
  );
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
