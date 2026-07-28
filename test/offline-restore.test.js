import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, test } from "node:test";

import { createBrowserSessionService } from "../src/browser-session.js";
import { openDurableCore } from "../src/durable-core.js";
import { createForgejoConnectionCredentialCipher } from "../src/forgejo-connection-credential.js";
import { createGitHubConnectionCredentialCipher } from "../src/github-connection-credential.js";
import { createImplementerTokenService } from "../src/implementer-token.js";
import { verifyInstallationKey } from "../src/installation-configuration.js";
import { restoreOfflineBackup } from "../src/offline-restore.js";
import {
  bootstrapOperatorPassword,
  verifyOperatorPassword,
} from "../src/operator-password.js";
import { createReviewService } from "../src/review.js";
import {
  createValidatedBackup,
  installationKeyIdentity,
} from "../src/sqlite-backup.js";

/** @type {string[]} */
const temporaryDirectories = [];

/** @param {string} name */
function reviewDefinition(name) {
  return {
    assignment: { scope: "installation_wide" },
    codex_configuration: {
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      service_tier: "standard",
    },
    criteria: [{ impact: "blocking", instruction: `Protect ${name}.` }],
    description: `${name} review facts.`,
    name,
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("restores snapshot-era canonical facts without post-backup work", async () => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-restore-"));
  temporaryDirectories.push(directory);
  const backupsPath = join(directory, "backups");
  const databasePath = join(directory, "quality-bar.sqlite3");
  const masterKey = Buffer.alloc(32, 7);
  const oldPassword = "the old operator password";
  const core = openDurableCore(databasePath);
  verifyInstallationKey(core, masterKey);
  bootstrapOperatorPassword(core, oldPassword);
  const reviews = createReviewService(core, {
    createId: (() => {
      let next = 0;
      return () => `restore-fact-${++next}`;
    })(),
  });
  reviews.create(reviewDefinition("Snapshot"));
  createBrowserSessionService(core).login(oldPassword);
  createImplementerTokenService(core).create(oldPassword);
  core.run(
    `INSERT INTO github_connections (
       singleton_key, id, app_id, app_slug, installation_id, principal_id,
       principal_login, api_profile, permissions, capabilities,
       repository_count, created_at, verified_at
     ) VALUES (1, 'github-connection', 1, 'quality-bar', 2, 3, 'operator',
               'github-rest:2026-03-10', '{}', '{}', 1, 100, 100)`,
  );
  const githubCipher = createGitHubConnectionCredentialCipher(masterKey);
  core.run(
    `INSERT INTO github_connection_credentials (
       connection_id, encrypted_credential, created_at
     ) VALUES ('github-connection', ?, 100)`,
    githubCipher.encrypt(
      { appId: 1, id: "github-connection" },
      { client_id: null, installation_id: 2, pem: "snapshot private key" },
    ),
  );
  githubCipher.destroy();
  core.run(
    `INSERT INTO github_repository_polls (
       connection_id, forge_repository_id, baseline_status, last_success_at,
       next_attempt_at, snapshot
     ) VALUES ('github-connection', 4, 'complete', 100, 200, '[]')`,
  );
  core.run(
    `INSERT INTO forgejo_connections (
       id, base_url, api_profile, reported_version, principal_id,
       principal_login, scopes, capabilities, health, created_at, verified_at
     ) VALUES ('forgejo-connection', 'https://forgejo.example',
               'forgejo-v16', '16.0.1', 5, 'operator', '[]', '{}',
               'healthy', 100, 100)`,
  );
  const forgejoCipher = createForgejoConnectionCredentialCipher(masterKey);
  core.run(
    `INSERT INTO forgejo_connection_credentials (
       connection_id, encrypted_credential, created_at
     ) VALUES ('forgejo-connection', ?, 100)`,
    forgejoCipher.encrypt("forgejo-connection", "snapshot token"),
  );
  forgejoCipher.destroy();
  core.run(
    `INSERT INTO forgejo_repository_polls (
       connection_id, forge_repository_id, baseline_status, last_success_at,
       next_attempt_at, snapshot
     ) VALUES ('forgejo-connection', 6, 'complete', 100, 200, '[]')`,
  );
  core.close();

  const backupSource = new DatabaseSync(databasePath);
  const backup = await createValidatedBackup({
    applicationVersion: "0.1.0",
    backupsPath,
    database: backupSource,
    keyIdentity: installationKeyIdentity(masterKey),
    kind: "daily",
  });
  backupSource.close();
  const postBackupCore = openDurableCore(databasePath);
  createReviewService(postBackupCore, {
    createId: (() => {
      let next = 3;
      return () => `restore-fact-${++next}`;
    })(),
  }).create(reviewDefinition("Post-backup"));
  postBackupCore.close();

  const restored = await restoreOfflineBackup({
    applicationVersion: "0.1.0",
    databasePath,
    manifestPath: backup.manifestPath,
    masterKey,
  });

  assert.deepEqual(restored, {
    applicationVersion: "0.1.0",
    schemaVersion: 21,
    status: "restored",
  });
  const restoredCore = openDurableCore(databasePath);
  assert.deepEqual(restoredCore.all("SELECT name FROM reviews ORDER BY name"), [
    { name: "Snapshot" },
  ]);
  assert.equal(
    restoredCore.get("SELECT count(*) AS count FROM browser_sessions")?.count,
    1,
  );
  assert.equal(
    typeof restoredCore.get(
      "SELECT value FROM quality_bar_metadata WHERE key = 'implementer_token_verifier'",
    )?.value,
    "string",
  );
  assert.deepEqual(
    restoredCore.all(
      `SELECT baseline_status, last_success_at, next_attempt_at, snapshot
         FROM github_repository_polls`,
    ),
    [
      {
        baseline_status: "complete",
        last_success_at: 100,
        next_attempt_at: 200,
        snapshot: "[]",
      },
    ],
  );
  assert.deepEqual(
    restoredCore.all(
      `SELECT baseline_status, last_success_at, next_attempt_at, snapshot
         FROM forgejo_repository_polls`,
    ),
    [
      {
        baseline_status: "complete",
        last_success_at: 100,
        next_attempt_at: 200,
        snapshot: "[]",
      },
    ],
  );
  verifyOperatorPassword(restoredCore, oldPassword);
  restoredCore.close();
});
