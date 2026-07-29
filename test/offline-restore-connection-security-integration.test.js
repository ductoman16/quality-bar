import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { createForgejoConnectionCredentialCipher } from "../src/forgejo-connection-credential.js";
import { createGitHubConnectionCredentialCipher } from "../src/github-connection-credential.js";
import { verifyInstallationKey } from "../src/installation-configuration.js";
import { restoreOfflineBackup } from "../src/offline-restore.js";
import { bootstrapOperatorPassword } from "../src/operator-password.js";
import {
  createValidatedBackup,
  installationKeyIdentity,
} from "../src/sqlite-backup.js";

/** @type {string[]} */
const temporaryDirectories = [];

function fixture() {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-restore-connection-security-"),
  );
  temporaryDirectories.push(directory);
  return {
    backupsPath: join(directory, "backups"),
    databasePath: join(directory, "quality-bar.sqlite3"),
    masterKey: Buffer.alloc(32, 7),
  };
}

/** @param {ReturnType<typeof fixture>} input */
async function backupFixture(input) {
  const database = new DatabaseSync(input.databasePath);
  const backup = await createValidatedBackup({
    applicationVersion: "0.1.0",
    backupsPath: input.backupsPath,
    database,
    keyIdentity: installationKeyIdentity(input.masterKey),
    kind: "daily",
  });
  database.close();
  return backup;
}

/** @param {ReturnType<typeof openDurableCore>} core @param {"github" | "forgejo"} connection */
function insertConnection(core, connection) {
  if (connection === "github") {
    core.run(
      `INSERT INTO github_connections (
         singleton_key, id, app_id, app_slug, installation_id, principal_id,
         principal_login, api_profile, permissions, capabilities,
         repository_count, created_at, verified_at
       ) VALUES (1, 'github-connection', 1, 'quality-bar', 2, 3, 'operator',
                 'github-rest:2026-03-10', '{}', '{}', 1, 100, 100)`,
    );
  } else {
    core.run(
      `INSERT INTO forgejo_connections (
         id, base_url, api_profile, reported_version, principal_id,
         principal_login, scopes, capabilities, health, created_at, verified_at
       ) VALUES ('forgejo-connection', 'https://forgejo.example',
                 'forgejo-v16', '16.0.1', 5, 'operator', '[]', '{}',
                 'healthy', 100, 100)`,
    );
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("missing enabled Connection credentials leave the stopped database unchanged", async () => {
  for (const connection of /** @type {const} */ (["github", "forgejo"])) {
    const input = fixture();
    const core = openDurableCore(input.databasePath);
    verifyInstallationKey(core, input.masterKey);
    bootstrapOperatorPassword(core, "the snapshot operator password");
    insertConnection(core, connection);
    core.close();
    const backup = await backupFixture(input);
    const original = readFileSync(input.databasePath);

    await assert.rejects(
      restoreOfflineBackup({
        applicationVersion: "0.1.0",
        databasePath: input.databasePath,
        manifestPath: backup.manifestPath,
        masterKey: input.masterKey,
        operatorPassword: "a replacement operator password",
      }),
      (error) =>
        error instanceof Error &&
        "code" in error &&
        error.code === `${connection}_connection_credential_missing`,
    );

    assert.deepEqual(readFileSync(input.databasePath), original);
  }
});

test("undecryptable GitHub and Forgejo credentials leave the stopped database unchanged", async () => {
  for (const connection of /** @type {const} */ (["github", "forgejo"])) {
    const input = fixture();
    const core = openDurableCore(input.databasePath);
    verifyInstallationKey(core, input.masterKey);
    bootstrapOperatorPassword(core, "the snapshot operator password");
    insertConnection(core, connection);
    if (connection === "github") {
      const cipher = createGitHubConnectionCredentialCipher(input.masterKey);
      core.run(
        `INSERT INTO github_connection_credentials (
           connection_id, encrypted_credential, created_at
         ) VALUES ('github-connection', ?, 100)`,
        cipher.encrypt(
          { appId: 999, id: "wrong-connection" },
          { client_id: null, installation_id: 2, pem: "private key" },
        ),
      );
      cipher.destroy();
    } else {
      const cipher = createForgejoConnectionCredentialCipher(input.masterKey);
      core.run(
        `INSERT INTO forgejo_connection_credentials (
           connection_id, encrypted_credential, created_at
         ) VALUES ('forgejo-connection', ?, 100)`,
        cipher.encrypt("wrong-connection", "token"),
      );
      cipher.destroy();
    }
    core.close();
    const backup = await backupFixture(input);
    const original = readFileSync(input.databasePath);

    await assert.rejects(
      restoreOfflineBackup({
        applicationVersion: "0.1.0",
        databasePath: input.databasePath,
        manifestPath: backup.manifestPath,
        masterKey: input.masterKey,
        operatorPassword: "a replacement operator password",
      }),
      (error) =>
        error instanceof Error &&
        "code" in error &&
        error.code ===
          (connection === "github"
            ? "github_connection_credential_undecryptable"
            : "forgejo_credential_undecryptable"),
    );

    assert.deepEqual(readFileSync(input.databasePath), original);
  }
});
