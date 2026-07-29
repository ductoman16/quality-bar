import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, test } from "node:test";

import { createBrowserSessionService } from "../src/browser-session.js";
import { openDurableCore } from "../src/durable-core.js";
import { createImplementerTokenService } from "../src/implementer-token.js";
import { verifyInstallationKey } from "../src/installation-configuration.js";
import { restoreOfflineBackup } from "../src/offline-restore.js";
import {
  bootstrapOperatorPassword,
  verifyOperatorPassword,
} from "../src/operator-password.js";
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

test("restore requires fresh host authority and retains no restored credential", async () => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-restore-authority-"),
  );
  temporaryDirectories.push(directory);
  const databasePath = join(directory, "quality-bar.sqlite3");
  const masterKey = Buffer.alloc(32, 7);
  const snapshotPassword = "the snapshot operator password";
  const restoredPassword = "the newly restored operator password";
  const core = openDurableCore(databasePath);
  verifyInstallationKey(core, masterKey);
  bootstrapOperatorPassword(core, snapshotPassword);
  createBrowserSessionService(core).login(snapshotPassword);
  createImplementerTokenService(core).create(snapshotPassword);
  core.close();
  const database = new DatabaseSync(databasePath);
  const backup = await createValidatedBackup({
    applicationVersion: "0.1.0",
    backupsPath: join(directory, "backups"),
    database,
    keyIdentity: installationKeyIdentity(masterKey),
    kind: "daily",
  });
  database.close();
  const original = readFileSync(databasePath);

  await assert.rejects(
    restoreOfflineBackup({
      applicationVersion: "0.1.0",
      databasePath,
      manifestPath: backup.manifestPath,
      masterKey,
      operatorPassword: undefined,
    }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "operator_password_input_missing",
  );
  assert.deepEqual(readFileSync(databasePath), original);

  await restoreOfflineBackup({
    applicationVersion: "0.1.0",
    databasePath,
    manifestPath: backup.manifestPath,
    masterKey,
    operatorPassword: restoredPassword,
  });

  const restored = openDurableCore(databasePath);
  verifyOperatorPassword(restored, restoredPassword);
  assert.throws(
    () => verifyOperatorPassword(restored, snapshotPassword),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "authentication_invalid",
  );
  assert.equal(
    restored.get("SELECT COUNT(*) AS count FROM browser_sessions")?.count,
    0,
  );
  assert.equal(
    restored.get(
      "SELECT value FROM quality_bar_metadata WHERE key = 'implementer_token_verifier'",
    ),
    undefined,
  );
  restored.close();
});
