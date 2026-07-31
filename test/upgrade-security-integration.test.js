import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import {
  preparePreMigrationBackup,
  runDailyBackupIfDue,
} from "../src/installed-backup.js";
import { installationKeyIdentity } from "../src/sqlite-backup.js";

/** @type {string[]} */
const temporaryDirectories = [];

function fixture() {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-upgrade-security-"),
  );
  temporaryDirectories.push(directory);
  const databasePath = join(directory, "quality-bar.sqlite3");
  const backupsPath = join(directory, "backups");
  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA user_version = 19;
    CREATE TABLE quality_bar_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;
    INSERT INTO quality_bar_metadata (key, value)
    VALUES ('schema_version', '19');
  `);
  database.close();
  return { backupsPath, databasePath };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("pre-migration rollback metadata is scoped to the active installation key and does not disclose either key", async () => {
  const { backupsPath, databasePath } = fixture();
  const activeKey = Buffer.alloc(32, 7);
  const otherKey = Buffer.alloc(32, 8);
  const activeKeyIdentity = installationKeyIdentity(activeKey);

  await runDailyBackupIfDue({
    applicationVersion: "9.9.9",
    backupsPath,
    databasePath,
    keyIdentity: installationKeyIdentity(otherKey),
    now: () => Date.parse("2026-07-26T01:02:03Z"),
    schemaVersion: 19,
  });
  await runDailyBackupIfDue({
    applicationVersion: "1.1.0",
    backupsPath,
    databasePath,
    keyIdentity: activeKeyIdentity,
    now: () => Date.parse("2026-07-27T01:02:03Z"),
    schemaVersion: 19,
  });

  const result = await preparePreMigrationBackup({
    backupsPath,
    databasePath,
    keyIdentity: activeKeyIdentity,
    now: () => Date.parse("2026-07-28T01:02:03Z"),
    targetSchemaVersion: 20,
  });
  const manifest = readFileSync(result?.manifestPath ?? "", "utf8");

  assert.equal(result?.applicationVersion, "1.1.0");
  assert.match(
    manifest,
    /"installation_key_identity":\s+"sha256:[0-9a-f]{64}"/,
  );
  assert.equal(manifest.includes(activeKey.toString("base64")), false);
  assert.equal(manifest.includes(otherKey.toString("base64")), false);
  assert.doesNotMatch(manifest, /\.\.[/\\]/);
});
