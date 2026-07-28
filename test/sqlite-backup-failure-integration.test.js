import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, test } from "node:test";

import {
  createValidatedBackup,
  installationKeyIdentity,
} from "../src/sqlite-backup.js";

/** @type {string[]} */
const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("invalid SQLite backup output is discarded and never reported as success", async () => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-backup-failure-"));
  temporaryDirectories.push(directory);
  const backupsPath = join(directory, "backups");
  const database = new DatabaseSync(join(directory, "quality-bar.sqlite3"));
  database.exec("PRAGMA user_version = 20");

  await assert.rejects(
    createValidatedBackup({
      applicationVersion: "1.2.3",
      backupsPath,
      database,
      keyIdentity: installationKeyIdentity(Buffer.alloc(32, 7)),
      kind: "daily",
      performBackup: async (sourceDatabase, destinationPath) => {
        void sourceDatabase;
        writeFileSync(destinationPath, "not a SQLite database");
        return 0;
      },
    }),
    (error) => {
      assert.ok(error instanceof Error && "code" in error);
      assert.equal(error.code, "backup_integrity_check_failed");
      assert.equal(error.message, "SQLite backup is not valid");
      return true;
    },
  );

  assert.deepEqual(readdirSync(backupsPath), []);
  database.close();
});
