import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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

test("backup identity is stable without copying the installation master key", async () => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-backup-security-"));
  temporaryDirectories.push(directory);
  const database = new DatabaseSync(join(directory, "quality-bar.sqlite3"));
  database.exec(`
    PRAGMA user_version = 53;
    CREATE TABLE retained_fact (value TEXT PRIMARY KEY) STRICT;
    INSERT INTO retained_fact (value) VALUES ('safe');
  `);
  const masterKey = Buffer.alloc(32, 7);
  const encodedMasterKey = masterKey.toString("base64");
  const keyIdentity = installationKeyIdentity(masterKey);

  const created = await createValidatedBackup({
    applicationVersion: "1.2.3",
    backupsPath: join(directory, "backups"),
    database,
    keyIdentity,
    kind: "daily",
  });

  assert.equal(installationKeyIdentity(Buffer.from(masterKey)), keyIdentity);
  assert.notEqual(installationKeyIdentity(Buffer.alloc(32, 8)), keyIdentity);
  assert.equal(
    readFileSync(created.manifestPath, "utf8").includes(encodedMasterKey),
    false,
  );
  assert.equal(
    readFileSync(created.databasePath).includes(Buffer.from(encodedMasterKey)),
    false,
  );
  database.close();
});
