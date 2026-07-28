import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, test } from "node:test";

import {
  finalizePreMigrationBackup,
  preparePreMigrationBackup,
  runDailyBackupIfDue,
} from "../src/installed-backup.js";
import { installationKeyIdentity } from "../src/sqlite-backup.js";

/** @type {string[]} */
const temporaryDirectories = [];

function fixture() {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-installed-backup-"),
  );
  temporaryDirectories.push(directory);
  const databasePath = join(directory, "quality-bar.sqlite3");
  const backupsPath = join(directory, "backups");
  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA journal_mode = WAL;
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

test("creates one validated snapshot before an existing schema is migrated", async () => {
  const { backupsPath, databasePath } = fixture();
  const keyIdentity = installationKeyIdentity(Buffer.alloc(32, 7));

  const result = await preparePreMigrationBackup({
    applicationVersion: "1.2.3",
    backupsPath,
    databasePath,
    keyIdentity,
    now: () => Date.parse("2026-07-28T01:02:03Z"),
    targetSchemaVersion: 20,
  });

  assert.equal(result?.kind, "pre-migration");
  assert.equal(result?.schemaVersion, 19);
  const unchanged = new DatabaseSync(databasePath, { readOnly: true });
  assert.equal(
    unchanged.prepare("PRAGMA user_version").get()?.user_version,
    19,
  );
  unchanged.close();
  assert.deepEqual(readdirSync(backupsPath).sort(), [
    "quality-bar-pre-migration-2026-07-28T01-02-03-000Z.json",
    "quality-bar-pre-migration-2026-07-28T01-02-03-000Z.sqlite3",
  ]);
});

test("pre-migration surfaces an exact source status failure", async () => {
  const { backupsPath, databasePath } = fixture();

  await assert.rejects(
    preparePreMigrationBackup({
      applicationVersion: "1.2.3",
      backupsPath,
      databasePath: join(databasePath, "child"),
      keyIdentity: installationKeyIdentity(Buffer.alloc(32, 7)),
      targetSchemaVersion: 20,
    }),
    (error) => {
      assert.ok(error instanceof Error && "code" in error);
      assert.equal(error.code, "ENOTDIR");
      return true;
    },
  );
});

test("creates at most one successful daily backup for a UTC day", async () => {
  const { backupsPath, databasePath } = fixture();
  const keyIdentity = installationKeyIdentity(Buffer.alloc(32, 7));
  const input = {
    applicationVersion: "1.2.3",
    backupsPath,
    databasePath,
    keyIdentity,
    now: () => Date.parse("2026-07-28T01:02:03Z"),
  };

  const created = await runDailyBackupIfDue(input);
  const current = await runDailyBackupIfDue({
    ...input,
    applicationVersion: "2.0.0",
  });

  assert.equal(created.status, "created");
  assert.equal(current.status, "current");
  const manifests = readdirSync(backupsPath).filter((file) =>
    file.endsWith(".json"),
  );
  assert.equal(manifests.length, 1);
  assert.equal(
    JSON.parse(readFileSync(join(backupsPath, manifests[0]), "utf8")).kind,
    "daily",
  );
});

test("a manifest cannot substitute a file outside the backup directory", async () => {
  const { backupsPath, databasePath } = fixture();
  mkdirSync(backupsPath);
  writeFileSync(
    join(backupsPath, "quality-bar-daily-tampered.json"),
    `${JSON.stringify({
      application_version: "1.2.3",
      created_at: "2026-07-28T00:00:00.000Z",
      database_file: "../quality-bar.sqlite3",
      installation_key_identity: installationKeyIdentity(Buffer.alloc(32, 7)),
      kind: "daily",
      schema_version: 19,
    })}\n`,
  );
  const originalDatabase = readFileSync(databasePath);

  const result = await runDailyBackupIfDue({
    applicationVersion: "1.2.3",
    backupsPath,
    databasePath,
    keyIdentity: installationKeyIdentity(Buffer.alloc(32, 7)),
    now: () => Date.parse("2026-07-28T01:02:03Z"),
  });

  assert.equal(result.status, "created");
  assert.deepEqual(readFileSync(databasePath), originalDatabase);
  assert.equal(
    readdirSync(backupsPath).filter((file) => file.endsWith(".sqlite3")).length,
    1,
  );
});

test("startup discards malformed, orphaned, and interrupted backup output", async () => {
  const { backupsPath, databasePath } = fixture();
  mkdirSync(backupsPath);
  writeFileSync(
    join(backupsPath, "quality-bar-daily-malformed.json"),
    "{not-json",
  );
  writeFileSync(
    join(backupsPath, "quality-bar-daily-malformed.sqlite3"),
    "invalid",
  );
  writeFileSync(
    join(backupsPath, "quality-bar-daily-corrupt.json"),
    `${JSON.stringify({
      application_version: "1.2.3",
      created_at: "2026-07-27T00:00:00.000Z",
      database_file: "quality-bar-daily-corrupt.sqlite3",
      installation_key_identity: installationKeyIdentity(Buffer.alloc(32, 7)),
      kind: "daily",
      schema_version: 19,
    })}\n`,
  );
  writeFileSync(
    join(backupsPath, "quality-bar-daily-corrupt.sqlite3"),
    "not a SQLite database",
  );
  writeFileSync(
    join(backupsPath, "quality-bar-daily-orphan.sqlite3"),
    "orphan",
  );
  writeFileSync(
    join(backupsPath, ".quality-bar-daily-interrupted.sqlite3"),
    "interrupted",
  );

  const result = await runDailyBackupIfDue({
    applicationVersion: "1.2.3",
    backupsPath,
    databasePath,
    keyIdentity: installationKeyIdentity(Buffer.alloc(32, 7)),
    now: () => Date.parse("2026-07-28T01:02:03Z"),
  });

  assert.equal(result.status, "created");
  assert.deepEqual(
    readdirSync(backupsPath)
      .filter((file) => !file.endsWith("-wal") && !file.endsWith("-shm"))
      .sort(),
    [
      "quality-bar-daily-2026-07-28T01-02-03-000Z.json",
      "quality-bar-daily-2026-07-28T01-02-03-000Z.sqlite3",
    ],
  );
});

test("startup surfaces an exact operational backup-read failure", async () => {
  const { backupsPath, databasePath } = fixture();
  writeFileSync(backupsPath, "not-a-directory");

  await assert.rejects(
    runDailyBackupIfDue({
      applicationVersion: "1.2.3",
      backupsPath,
      databasePath,
      keyIdentity: installationKeyIdentity(Buffer.alloc(32, 7)),
      now: () => Date.parse("2026-07-28T01:02:03Z"),
    }),
    (error) => {
      assert.ok(error instanceof Error && "code" in error);
      assert.equal(error.code, "ENOTDIR");
      return true;
    },
  );
  assert.equal(readFileSync(backupsPath, "utf8"), "not-a-directory");
});

test("pre-migration retention advances only after migration validation", async () => {
  const { backupsPath, databasePath } = fixture();
  const keyIdentity = installationKeyIdentity(Buffer.alloc(32, 7));
  const input = {
    applicationVersion: "1.2.3",
    backupsPath,
    databasePath,
    keyIdentity,
    targetSchemaVersion: 20,
  };
  await preparePreMigrationBackup({
    ...input,
    now: () => Date.parse("2026-07-27T01:02:03Z"),
  });
  await preparePreMigrationBackup({
    ...input,
    now: () => Date.parse("2026-07-28T01:02:03Z"),
  });

  assert.equal(readdirSync(backupsPath).length, 4);
  finalizePreMigrationBackup(backupsPath);
  assert.deepEqual(readdirSync(backupsPath).sort(), [
    "quality-bar-pre-migration-2026-07-28T01-02-03-000Z.json",
    "quality-bar-pre-migration-2026-07-28T01-02-03-000Z.sqlite3",
  ]);
});
