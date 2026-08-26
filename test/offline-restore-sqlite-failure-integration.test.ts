import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, test } from "node:test";

import { createBrowserSessionService } from "../src/browser-session.ts";
import { openDurableCore } from "../src/durable/durable-core.ts";
import { createImplementerTokenService } from "../src/implementer-token.ts";
import { verifyInstallationKey } from "../src/installation-configuration.ts";
import { restoreOfflineBackup } from "../src/offline/offline-restore.ts";
import {
  bootstrapOperatorPassword,
  recoverOperatorAuthority,
} from "../src/operator/operator-password.ts";
import {
  createValidatedBackup,
  installationKeyIdentity,
} from "../src/sqlite-backup.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

async function restoreFixture() {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-restore-failure-"));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, "quality-bar.sqlite3");
  const backupsPath = join(directory, "backups");
  const masterKey = Buffer.alloc(32, 7);
  const core = openDurableCore(databasePath);
  verifyInstallationKey(core, masterKey);
  const snapshotPassword = "the snapshot operator password";
  bootstrapOperatorPassword(core, snapshotPassword);
  createBrowserSessionService(core).login(snapshotPassword);
  createImplementerTokenService(core).create(snapshotPassword);
  core.close();
  const database = new DatabaseSync(databasePath);
  const backup = await createValidatedBackup({
    applicationVersion: "0.1.0",
    backupsPath,
    database,
    keyIdentity: installationKeyIdentity(masterKey),
    kind: "daily",
  });
  database.close();
  const current = openDurableCore(databasePath);
  current.run(
    "INSERT INTO quality_bar_metadata (key, value) VALUES ('post_backup_fact', 'preserved-on-failure')",
  );
  current.close();
  const original = readFileSync(databasePath);
  return { backup, databasePath, directory, masterKey, original };
}

test("authority invalidation failure leaves the pre-restore database authoritative", async () => {
  const { backup, databasePath, masterKey, original } = await restoreFixture();

  await assert.rejects(
    restoreOfflineBackup({
      applicationVersion: "0.1.0",
      databasePath,
      manifestPath: backup.manifestPath,
      masterKey,
      operatorPassword: "the restored operator password",
      recoverAuthority(core, password) {
        core.run(`
          CREATE TRIGGER reject_restore_session_revocation
          BEFORE DELETE ON browser_sessions
          BEGIN
            SELECT RAISE(ABORT, 'restore_session_revocation_failed');
          END
        `);
        recoverOperatorAuthority(core, password);
      },
    }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "ERR_SQLITE_ERROR" &&
      error.message === "restore_session_revocation_failed",
  );

  assert.deepEqual(readFileSync(databasePath), original);
  const unchanged = openDurableCore(databasePath);
  assert.equal(
    unchanged.get(
      "SELECT value FROM quality_bar_metadata WHERE key = 'post_backup_fact'",
    )?.value,
    "preserved-on-failure",
  );
  unchanged.close();
});

test("a failed fsync leaves the original database authoritative", async () => {
  const { backup, databasePath, directory, masterKey, original } =
    await restoreFixture();
  const commitFailure = Object.assign(new Error("atomic rename failed"), {
    code: "EIO",
  });
  let candidatePublished = false;
  let commitSyncFailed = false;

  await assert.rejects(
    restoreOfflineBackup({
      applicationVersion: "0.1.0",
      commitOperations: {
        publicationBoundary(boundary) {
          candidatePublished ||= boundary === "candidate-published";
        },
        synchronizePath(path) {
          if (
            candidatePublished &&
            !commitSyncFailed &&
            path === dirname(databasePath)
          ) {
            commitSyncFailed = true;
            throw commitFailure;
          }
        },
      },
      databasePath,
      manifestPath: backup.manifestPath,
      masterKey,
      operatorPassword: "a replacement operator password",
    }),
    (error) => error === commitFailure,
  );

  assert.deepEqual(readFileSync(databasePath), original);
  assert.deepEqual(
    readdirSync(directory).filter((name) =>
      name.startsWith(".quality-bar-restore-"),
    ),
    [],
  );
  const unchanged = openDurableCore(databasePath);
  assert.equal(
    unchanged.get(
      "SELECT value FROM quality_bar_metadata WHERE key = 'post_backup_fact'",
    )?.value,
    "preserved-on-failure",
  );
  unchanged.close();
});

test("a checkpoint storage failure is returned without replacing the target", async () => {
  const { backup, databasePath, directory, masterKey, original } =
    await restoreFixture();
  const checkpointFailure = Object.assign(
    new Error("checkpoint storage failed"),
    { code: "SQLITE_IOERR", errcode: 10 },
  );

  await assert.rejects(
    restoreOfflineBackup({
      applicationVersion: "0.1.0",
      commitOperations: {
        checkpoint() {
          throw checkpointFailure;
        },
      },
      databasePath,
      manifestPath: backup.manifestPath,
      masterKey,
      operatorPassword: "a replacement operator password",
    }),
    (error) => error === checkpointFailure,
  );

  assert.deepEqual(readFileSync(databasePath), original);
  assert.deepEqual(
    readdirSync(directory).filter((name) =>
      name.startsWith(".quality-bar-restore-"),
    ),
    [],
  );
});

test("partial old-state cleanup keeps the durable restored database authoritative", async () => {
  const { backup, databasePath, directory, masterKey } = await restoreFixture();
  const cleanupFailure = Object.assign(new Error("old state cleanup failed"), {
    code: "EIO",
  });
  let retainedPath = "";
  await assert.rejects(
    restoreOfflineBackup({
      applicationVersion: "0.1.0",
      commitOperations: {
        removeDirectory(path) {
          rmSync(join(path, "quality-bar.sqlite3.previous-0"));
          throw cleanupFailure;
        },
      },
      databasePath,
      manifestPath: backup.manifestPath,
      masterKey,
      operatorPassword: "a replacement operator password",
    }),
    (error) => {
      if (
        !(
          error instanceof Error &&
          "code" in error &&
          error.code === "restore_previous_state_cleanup_failed" &&
          "targetCommitted" in error &&
          error.targetCommitted === true &&
          "retainedPath" in error &&
          typeof error.retainedPath === "string"
        )
      ) {
        return false;
      }
      retainedPath = error.retainedPath;
      return true;
    },
  );

  if (!retainedPath) {
    throw new Error("restore_cleanup_retained_path_missing");
  }
  assert.equal(retainedPath.includes(directory), true);
  const restored = openDurableCore(databasePath);
  assert.equal(
    restored.get(
      "SELECT value FROM quality_bar_metadata WHERE key = 'post_backup_fact'",
    ),
    undefined,
  );
  restored.close();
});

test("rollback failure retains both databases for operator recovery", async () => {
  const { backup, databasePath, masterKey } = await restoreFixture();
  const commitFailure = Object.assign(new Error("atomic rename failed"), {
    code: "EIO",
  });
  const rollbackFailure = new Error("original database rollback failed");
  let candidatePublished = false;
  let retainedPath = "";
  await assert.rejects(
    restoreOfflineBackup({
      applicationVersion: "0.1.0",
      commitOperations: {
        rename(from, to) {
          if (
            from.endsWith("quality-bar.sqlite3.previous-0") &&
            to === databasePath
          ) {
            throw rollbackFailure;
          }
          renameSync(from, to);
        },
        publicationBoundary(boundary) {
          candidatePublished ||= boundary === "candidate-published";
        },
        synchronizePath(path) {
          if (candidatePublished && path === dirname(databasePath)) {
            throw commitFailure;
          }
        },
      },
      databasePath,
      manifestPath: backup.manifestPath,
      masterKey,
      operatorPassword: "a replacement operator password",
    }),
    (error) => {
      if (
        !(
          error instanceof Error &&
          "code" in error &&
          error.code === "restore_commit_rollback_failed" &&
          error.cause instanceof AggregateError &&
          error.cause.errors.includes(rollbackFailure) &&
          "retainedPath" in error &&
          typeof error.retainedPath === "string"
        )
      ) {
        return false;
      }
      retainedPath = error.retainedPath;
      return true;
    },
  );

  if (!retainedPath) {
    throw new Error("restore_rollback_retained_path_missing");
  }
  assert.deepEqual(readdirSync(retainedPath).sort(), [
    "quality-bar.sqlite3",
    "quality-bar.sqlite3.previous-0",
  ]);
});

test("rollback directory fsync failure retains the restored candidate", async () => {
  const { backup, databasePath, masterKey } = await restoreFixture();
  const commitFailure = Object.assign(new Error("target fsync failed"), {
    code: "EIO",
  });
  const rollbackSyncFailure = Object.assign(
    new Error("rollback directory fsync failed"),
    { code: "EIO" },
  );
  let candidatePublished = false;
  let forwardSyncFailed = false;
  let retainedPath = "";

  await assert.rejects(
    restoreOfflineBackup({
      applicationVersion: "0.1.0",
      commitOperations: {
        publicationBoundary(boundary) {
          candidatePublished ||= boundary === "candidate-published";
        },
        synchronizePath(path) {
          if (
            candidatePublished &&
            !forwardSyncFailed &&
            path === dirname(databasePath)
          ) {
            forwardSyncFailed = true;
            throw commitFailure;
          }
          if (forwardSyncFailed && path === dirname(databasePath)) {
            throw rollbackSyncFailure;
          }
        },
      },
      databasePath,
      manifestPath: backup.manifestPath,
      masterKey,
      operatorPassword: "a replacement operator password",
    }),
    (error) => {
      if (
        !(
          error instanceof Error &&
          "code" in error &&
          error.code === "restore_commit_rollback_failed" &&
          error.cause instanceof AggregateError &&
          error.cause.errors.includes(rollbackSyncFailure) &&
          "retainedPath" in error &&
          typeof error.retainedPath === "string"
        )
      ) {
        return false;
      }
      retainedPath = error.retainedPath;
      return true;
    },
  );

  if (!retainedPath) {
    throw new Error("restore_rollback_sync_retained_path_missing");
  }
  assert.deepEqual(readdirSync(retainedPath), ["quality-bar.sqlite3"]);
  const original = openDurableCore(databasePath);
  assert.equal(
    original.get(
      "SELECT value FROM quality_bar_metadata WHERE key = 'post_backup_fact'",
    )?.value,
    "preserved-on-failure",
  );
  original.close();
});

test("every publication crash boundary leaves one complete authoritative database", async () => {
  const boundaries = [
    ["original-consolidated", "preserved-on-failure"],
    ["original-retained", "preserved-on-failure"],
    ["candidate-published", undefined],
    ["publication-durable", undefined],
  ] as Array<[string, string | undefined]>;
  for (const [boundary, expectedPostBackupFact] of boundaries) {
    const { backup, databasePath, masterKey } = await restoreFixture();
    const crashed = spawnSync(
      process.execPath,
      [
        resolve(
          import.meta.dirname,
          "../fixtures/test-probes/offline-restore-crash.mjs",
        ),
        databasePath,
        backup.manifestPath,
        masterKey.toString("hex"),
        boundary,
      ],
      { encoding: "utf8" },
    );
    assert.equal(crashed.signal, "SIGKILL", crashed.stderr);

    const authoritative = openDurableCore(databasePath);
    assert.equal(
      authoritative.get(
        "SELECT value FROM quality_bar_metadata WHERE key = 'post_backup_fact'",
      )?.value,
      expectedPostBackupFact,
    );
    authoritative.close();
  }
});
