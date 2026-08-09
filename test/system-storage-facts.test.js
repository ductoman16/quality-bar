import assert from "node:assert/strict";
import test from "node:test";

import { readSystemStorageFacts } from "../src/system-storage-facts.js";

const NOW = Date.parse("2026-08-02T12:00:00.000Z");
const KEY_IDENTITY = `sha256:${"a".repeat(64)}`;

function durableCore(schemaVersionBeforeMigration = 53) {
  return {
    facts: {
      databaseVersion: "3.49.1",
      foreignKeys: true,
      integrity: "ok",
      journalMode: "wal",
      schemaVersion: 53,
      schemaVersionBeforeMigration,
      synchronous: "full",
    },
  };
}

/** @param {"daily" | "pre-migration"} kind @param {number} createdAt @param {number} [schemaVersion] */
function backup(kind, createdAt, schemaVersion = 53) {
  return {
    applicationVersion: "1.2.3",
    createdAt: new Date(createdAt).toISOString(),
    databasePath: `/backups/${kind}.sqlite3`,
    keyIdentity: KEY_IDENTITY,
    kind,
    manifestPath: `/backups/${kind}.json`,
    schemaVersion,
  };
}

/** @param {any[]} backups */
function readFacts(backups) {
  /** @param {{kind?: "daily" | "pre-migration"}} [input] */
  function select({ kind } = {}) {
    return backups.filter((/** @type {any} */ backup) => backup.kind === kind);
  }
  return select;
}

test("System storage facts expose current identity, backup, and migration state", () => {
  const daily = backup("daily", NOW);
  const facts = readSystemStorageFacts({
    applicationVersion: "1.2.3",
    backupsPath: "/backups",
    durableCore: durableCore(),
    installationKeyIdentity: KEY_IDENTITY,
    now: () => NOW,
    readBackups: readFacts([daily]),
  });

  assert.deepEqual(facts, {
    application: {
      application_version: "1.2.3",
      error: null,
      installation_key_identity: KEY_IDENTITY,
      schema_version: 53,
      status: "available",
    },
    backup: {
      error: null,
      last_successful: {
        application_version: "1.2.3",
        created_at: daily.createdAt,
        installation_key_identity: KEY_IDENTITY,
        kind: "daily",
        schema_version: 53,
      },
      status: "current",
    },
    migration: {
      error: null,
      from_schema_version: 53,
      pre_migration_snapshot: null,
      pre_migration_snapshot_status: "not_applicable",
      status: "not_required",
      to_schema_version: 53,
    },
  });
});

test("System storage facts distinguish empty and stale backups", () => {
  const stale = backup("daily", NOW - 24 * 60 * 60 * 1_000);
  const empty = readSystemStorageFacts({
    applicationVersion: "1.2.3",
    backupsPath: "/backups",
    durableCore: durableCore(),
    installationKeyIdentity: KEY_IDENTITY,
    now: () => NOW,
    readBackups: readFacts([]),
  });
  const staleFacts = readSystemStorageFacts({
    applicationVersion: "1.2.3",
    backupsPath: "/backups",
    durableCore: durableCore(),
    installationKeyIdentity: KEY_IDENTITY,
    now: () => NOW,
    readBackups: readFacts([stale]),
  });

  assert.equal(empty.backup.status, "empty");
  assert.equal(empty.backup.last_successful, null);
  assert.equal(staleFacts.backup.status, "stale");
  assert.deepEqual(staleFacts.backup.last_successful, {
    application_version: "1.2.3",
    created_at: stale.createdAt,
    installation_key_identity: KEY_IDENTITY,
    kind: "daily",
    schema_version: 53,
  });
});

test("System storage facts retain exact backup failure and never infer success", () => {
  const failure = Object.assign(
    new Error("Backup directory could not be read."),
    {
      code: "backup_directory_read_failed",
    },
  );
  const facts = readSystemStorageFacts({
    applicationVersion: "1.2.3",
    backupsPath: "/backups",
    durableCore: durableCore(),
    installationKeyIdentity: KEY_IDENTITY,
    now: () => NOW,
    readBackups() {
      throw failure;
    },
  });

  assert.deepEqual(facts.backup, {
    error: {
      code: "backup_directory_read_failed",
      detail: "Backup directory could not be read.",
    },
    last_successful: null,
    status: "unavailable",
  });
});

test("System storage facts require a retained pre-migration snapshot after migration", () => {
  const facts = readSystemStorageFacts({
    applicationVersion: "1.2.3",
    backupsPath: "/backups",
    durableCore: durableCore(51),
    installationKeyIdentity: KEY_IDENTITY,
    now: () => NOW,
    readBackups: readFacts([]),
  });

  assert.deepEqual(facts.migration, {
    error: {
      code: "prior_image_backup_unavailable",
      detail: "A validated prior-image backup is required before migration",
    },
    from_schema_version: 51,
    pre_migration_snapshot: null,
    pre_migration_snapshot_status: "missing",
    status: "unavailable",
    to_schema_version: 53,
  });
});
