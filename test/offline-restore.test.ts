import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, test } from "node:test";

import { createBrowserSessionService } from "../src/browser-session.ts";
import { openDurableCore } from "../src/durable/durable-core.ts";
import { createForgejoConnectionCredentialCipher } from "../src/forgejo/forgejo-connection-credential.ts";
import { createGitHubConnectionCredentialCipher } from "../src/github/github-connection-credential.ts";
import { createImplementerTokenService } from "../src/implementer-token.ts";
import { verifyInstallationKey } from "../src/installation-configuration.ts";
import { restoreOfflineBackup } from "../src/offline/offline-restore.ts";
import {
  bootstrapOperatorPassword,
  verifyOperatorPassword,
} from "../src/operator/operator-password.ts";
import { createReviewService } from "../src/review/review.ts";
import {
  createValidatedBackup,
  installationKeyIdentity,
} from "../src/sqlite-backup.ts";

const temporaryDirectories: string[] = [];

function reviewDefinition(name: string) {
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
  const restoredPassword = "the restored operator password";
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
               'forgejo', '16.0.1', 5, 'operator', '[]', '{}',
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
    operatorPassword: restoredPassword,
  });

  assert.deepEqual(restored, {
    applicationVersion: "0.1.0",
    status: "restored",
  });
  const restoredCore = openDurableCore(databasePath);
  assert.deepEqual(restoredCore.all("SELECT name FROM reviews ORDER BY name"), [
    { name: "Snapshot" },
  ]);
  assert.equal(
    restoredCore.get("SELECT count(*) AS count FROM browser_sessions")?.count,
    0,
  );
  assert.equal(
    restoredCore.get(
      "SELECT value FROM quality_bar_metadata WHERE key = 'implementer_token_verifier'",
    ),
    undefined,
  );
  assert.deepEqual(
    restoredCore.all(
      `SELECT baseline_status, last_success_at, next_attempt_at, snapshot
         FROM github_repository_polls`,
    ),
    [
      {
        baseline_status: "pending",
        last_success_at: null,
        next_attempt_at: 0,
        snapshot: null,
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
        baseline_status: "pending",
        last_success_at: null,
        next_attempt_at: 0,
        snapshot: null,
      },
    ],
  );
  verifyOperatorPassword(restoredCore, restoredPassword);
  assert.throws(
    () => verifyOperatorPassword(restoredCore, oldPassword),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "authentication_invalid",
  );
  restoredCore.close();
});

test("restores a pre-bootstrap snapshot with the newly supplied password", async () => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-restore-pre-bootstrap-"),
  );
  temporaryDirectories.push(directory);
  const backupsPath = join(directory, "backups");
  const databasePath = join(directory, "quality-bar.sqlite3");
  const masterKey = Buffer.alloc(32, 7);
  const restoredPassword = "the restored operator password";
  const core = openDurableCore(databasePath);
  verifyInstallationKey(core, masterKey);
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

  await restoreOfflineBackup({
    applicationVersion: "0.1.0",
    databasePath,
    manifestPath: backup.manifestPath,
    masterKey,
    operatorPassword: restoredPassword,
  });

  const restored = openDurableCore(databasePath);
  verifyOperatorPassword(restored, restoredPassword);
  restored.close();
});

test("a pre-migration manifest uses the normal restore validation path", async () => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-restore-legacy-"));
  temporaryDirectories.push(directory);
  const stem = "quality-bar-pre-migration-fixture";
  const snapshotPath = join(directory, `${stem}.sqlite3`);
  const manifestPath = join(directory, `${stem}.json`);
  const masterKey = Buffer.alloc(32, 7);
  const snapshot = openDurableCore(snapshotPath);
  verifyInstallationKey(snapshot, masterKey);
  bootstrapOperatorPassword(snapshot, "the snapshot operator password");
  snapshot.close();
  writeFileSync(
    manifestPath,
    `${JSON.stringify({
      application_version: "0.1.0",
      created_at: new Date(0).toISOString(),
      database_file: `${stem}.sqlite3`,
      installation_key_identity: installationKeyIdentity(masterKey),
      kind: "pre-migration",
    })}\n`,
  );

  assert.deepEqual(
    await restoreOfflineBackup({
      applicationVersion: "0.1.0",
      databasePath: join(directory, "restored.sqlite3"),
      manifestPath,
      masterKey,
      operatorPassword: "the restored operator password",
    }),
    { applicationVersion: "0.1.0", status: "restored" },
  );
});
