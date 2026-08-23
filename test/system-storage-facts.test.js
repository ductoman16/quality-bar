import assert from "node:assert/strict";
import test from "node:test";

import { readSystemStorageFacts } from "../src/system/system-storage-facts.js";

const NOW = Date.parse("2026-08-02T12:00:00.000Z");
const KEY_IDENTITY = `sha256:${"a".repeat(64)}`;

/** @param {number} createdAt */
function backup(createdAt) {
  return {
    applicationVersion: "1.2.3",
    createdAt: new Date(createdAt).toISOString(),
    databasePath: "/backups/daily.sqlite3",
    keyIdentity: KEY_IDENTITY,
    kind: "daily",
    manifestPath: "/backups/daily.json",
  };
}

/** @param {any[]} backups */
function readFacts(backups) {
  /** @param {{kind?: "daily"}} [input] */
  function select({ kind } = {}) {
    return backups.filter((/** @type {any} */ backup) => backup.kind === kind);
  }
  return select;
}

test("System storage facts expose current identity and backup state", () => {
  const daily = backup(NOW);
  const facts = readSystemStorageFacts({
    applicationVersion: "1.2.3",
    backupsPath: "/backups",
    installationKeyIdentity: KEY_IDENTITY,
    now: () => NOW,
    readBackups: readFacts([daily]),
  });

  assert.deepEqual(facts, {
    application: {
      application_version: "1.2.3",
      error: null,
      installation_key_identity: KEY_IDENTITY,
      status: "available",
    },
    backup: {
      error: null,
      last_successful: {
        application_version: "1.2.3",
        created_at: daily.createdAt,
        installation_key_identity: KEY_IDENTITY,
        kind: "daily",
      },
      status: "current",
    },
  });
});

test("System storage facts distinguish empty and stale backups", () => {
  const stale = backup(NOW - 24 * 60 * 60 * 1_000);
  const empty = readSystemStorageFacts({
    applicationVersion: "1.2.3",
    backupsPath: "/backups",
    installationKeyIdentity: KEY_IDENTITY,
    now: () => NOW,
    readBackups: readFacts([]),
  });
  const staleFacts = readSystemStorageFacts({
    applicationVersion: "1.2.3",
    backupsPath: "/backups",
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
