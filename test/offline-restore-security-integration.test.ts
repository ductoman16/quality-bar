import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, test } from "node:test";

import { openDurableCore } from "../src/durable/durable-core.ts";
import { verifyInstallationKey } from "../src/installation-configuration.ts";
import { restoreOfflineBackup } from "../src/offline/offline-restore.ts";
import { restoreOfflineBackupFromHost } from "../src/offline/offline-restore-host.ts";
import { bootstrapOperatorPassword } from "../src/operator/operator-password.ts";
import {
  createValidatedBackup,
  installationKeyIdentity,
} from "../src/sqlite-backup.ts";

const temporaryDirectories: string[] = [];

function fixture() {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-restore-security-"),
  );
  temporaryDirectories.push(directory);
  return {
    backupsPath: join(directory, "backups"),
    databasePath: join(directory, "quality-bar.sqlite3"),
    masterKey: Buffer.alloc(32, 7),
  };
}

async function backupFixture(input: ReturnType<typeof fixture>) {
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

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("wrong installation key leaves the stopped database unchanged", async () => {
  const input = fixture();
  const core = openDurableCore(input.databasePath);
  verifyInstallationKey(core, input.masterKey);
  bootstrapOperatorPassword(core, "the snapshot operator password");
  core.close();
  const backup = await backupFixture(input);
  const original = readFileSync(input.databasePath);

  await assert.rejects(
    restoreOfflineBackup({
      applicationVersion: "0.1.0",
      databasePath: input.databasePath,
      manifestPath: backup.manifestPath,
      masterKey: Buffer.alloc(32, 8),
      operatorPassword: "a replacement operator password",
    }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "restore_key_identity_mismatch",
  );

  assert.deepEqual(readFileSync(input.databasePath), original);
});

test("a forged manifest key identity cannot replace snapshot key authentication", async () => {
  const input = fixture();
  const core = openDurableCore(input.databasePath);
  verifyInstallationKey(core, input.masterKey);
  bootstrapOperatorPassword(core, "the snapshot operator password");
  core.close();
  const backup = await backupFixture(input);
  const replacementKey = Buffer.alloc(32, 8);
  const manifest = JSON.parse(readFileSync(backup.manifestPath, "utf8"));
  manifest.installation_key_identity = installationKeyIdentity(replacementKey);
  writeFileSync(backup.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const original = readFileSync(input.databasePath);

  await assert.rejects(
    restoreOfflineBackup({
      applicationVersion: "0.1.0",
      databasePath: input.databasePath,
      manifestPath: backup.manifestPath,
      masterKey: replacementKey,
      operatorPassword: "a replacement operator password",
    }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "master_key_undecryptable",
  );

  assert.deepEqual(readFileSync(input.databasePath), original);
});

test("an undecryptable preserved credential leaves the stopped database unchanged", async () => {
  const input = fixture();
  const core = openDurableCore(input.databasePath);
  verifyInstallationKey(core, input.masterKey);
  bootstrapOperatorPassword(core, "the snapshot operator password");
  core.run(
    `INSERT INTO repositories (
       id, normalized_url, created_at, verified_at
     ) VALUES ('repository-1', 'https://git.example/repository.git', 1, 1)`,
  );
  core.run(
    `INSERT INTO repository_credentials (
       repository_id, encrypted_credential, created_at
     ) VALUES ('repository-1', 'not-an-envelope', 1)`,
  );
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
      error.code === "repository_credential_undecryptable",
  );

  assert.deepEqual(readFileSync(input.databasePath), original);
});

test("a corrupt snapshot fails before target mutation", async () => {
  const input = fixture();
  const core = openDurableCore(input.databasePath);
  verifyInstallationKey(core, input.masterKey);
  bootstrapOperatorPassword(core, "the snapshot operator password");
  core.close();
  const backup = await backupFixture(input);
  const original = readFileSync(input.databasePath);
  writeFileSync(backup.databasePath, "not a SQLite database");

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
      error.code === "restore_snapshot_integrity_invalid",
  );

  assert.deepEqual(readFileSync(input.databasePath), original);
});

test("incompatible application version leaves the target unavailable and unchanged", async () => {
  for (const mismatch of [
    {
      field: "application_version",
      value: "0.2.0",
      code: "restore_application_incompatible",
    },
  ]) {
    const input = fixture();
    const core = openDurableCore(input.databasePath);
    verifyInstallationKey(core, input.masterKey);
    bootstrapOperatorPassword(core, "the snapshot operator password");
    core.close();
    const backup = await backupFixture(input);
    const originalDatabase = readFileSync(input.databasePath);
    const manifest = JSON.parse(readFileSync(backup.manifestPath, "utf8"));
    manifest[mismatch.field] = mismatch.value;
    writeFileSync(
      backup.manifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
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
        error.code === mismatch.code,
    );
    assert.deepEqual(readFileSync(input.databasePath), originalDatabase);
  }
});

test("malformed restore identity and manifest fail before candidate creation", async () => {
  const input = fixture();
  const core = openDurableCore(input.databasePath);
  verifyInstallationKey(core, input.masterKey);
  bootstrapOperatorPassword(core, "the snapshot operator password");
  core.close();
  const backup = await backupFixture(input);

  await assert.rejects(
    restoreOfflineBackup({
      applicationVersion: "not-semantic",
      databasePath: input.databasePath,
      manifestPath: backup.manifestPath,
      masterKey: input.masterKey,
      operatorPassword: "a replacement operator password",
    }),
    TypeError,
  );
  const validManifest = JSON.parse(readFileSync(backup.manifestPath, "utf8"));
  for (const malformedIdentity of [
    { application_version: 1 },
    { installation_key_identity: "sha256:invalid" },
  ]) {
    writeFileSync(
      backup.manifestPath,
      `${JSON.stringify({ ...validManifest, ...malformedIdentity })}\n`,
    );
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
        error.code === "restore_manifest_invalid",
    );
  }
  writeFileSync(backup.manifestPath, "{not-json");
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
      error.code === "restore_manifest_invalid",
  );
});

test("missing snapshot fails with its exact diagnostic", async () => {
  const missingInput = fixture();
  const missingCore = openDurableCore(missingInput.databasePath);
  verifyInstallationKey(missingCore, missingInput.masterKey);
  bootstrapOperatorPassword(missingCore, "the snapshot operator password");
  missingCore.close();
  const missingBackup = await backupFixture(missingInput);
  rmSync(missingBackup.databasePath);
  await assert.rejects(
    restoreOfflineBackup({
      applicationVersion: "0.1.0",
      databasePath: missingInput.databasePath,
      manifestPath: missingBackup.manifestPath,
      masterKey: missingInput.masterKey,
      operatorPassword: "a replacement operator password",
    }),
    (error) =>
      error instanceof Error && "code" in error && error.code === "ENOENT",
  );
});

test("the host command accepts only one manifest argument", () => {
  const command = readFileSync(
    new URL("../src/restore-backup.ts", import.meta.url),
    "utf8",
  );
  assert.match(command, /process\.env\.QUALITY_BAR_VERSION/);
  assert.match(command, /process\.argv\[2\]/);
  assert.match(command, /process\.argv\.length !== 3/);
});

test("the host forwards the configured reserve and clears the loaded key", async () => {
  const masterKey = Buffer.alloc(32, 7);
  const freeSpaceReserveBytes = 7 * 1024 ** 3;
  const lockFailure = Object.assign(new Error("installation is running"), {
    code: "installation_locked",
  });
  let receivedReserveBytes;
  let passwordWasRead = false;

  await assert.rejects(
    restoreOfflineBackupFromHost({
      applicationVersion: "0.1.0",
      loadInstallation: () => ({ freeSpaceReserveBytes, masterKey }),
      manifestPath: "/var/backups/quality-bar/snapshot.json",
      readPassword() {
        passwordWasRead = true;
        return "a replacement operator password";
      },
      validateInstallation({ reserveBytes }) {
        receivedReserveBytes = reserveBytes;
        throw lockFailure;
      },
      validateSources() {},
    }),
    (error) => error === lockFailure,
  );

  assert.equal(receivedReserveBytes, freeSpaceReserveBytes);
  assert.equal(passwordWasRead, false);
  assert.deepEqual(masterKey, Buffer.alloc(32));
});

test("lock release failure cannot replace the owning restore diagnostic", async () => {
  const masterKey = Buffer.alloc(32, 7);
  const releaseFailure = new Error("lock release failed");

  await assert.rejects(
    restoreOfflineBackupFromHost({
      applicationVersion: "0.1.0",
      loadInstallation: () => ({
        freeSpaceReserveBytes: 5 * 1024 ** 3,
        masterKey,
      }),
      manifestPath: "/missing/restore-manifest.json",
      readPassword: () => "a replacement operator password",
      validateInstallation: () => ({
        releaseInstallationLock() {
          throw releaseFailure;
        },
      }),
      validateSources() {},
    }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT" &&
      error.cause instanceof AggregateError &&
      error.cause.errors.includes(releaseFailure),
  );

  assert.deepEqual(masterKey, Buffer.alloc(32));
});
