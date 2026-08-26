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

import { runDailyBackupIfDue } from "../src/installed-backup.ts";
import { installationKeyIdentity } from "../src/sqlite-backup.ts";

const temporaryDirectories: string[] = [];

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
    CREATE TABLE quality_bar_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;
  `);
  database.close();
  return { backupsPath, databasePath };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
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
