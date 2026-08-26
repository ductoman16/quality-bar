import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, test } from "node:test";

import { openDurableCore } from "../src/durable/durable-core.ts";
import { verifyInstallationKey } from "../src/installation-configuration.ts";
import { restoreOfflineBackup } from "../src/offline/offline-restore.ts";
import { bootstrapOperatorPassword } from "../src/operator/operator-password.ts";
import {
  createValidatedBackup,
  installationKeyIdentity,
} from "../src/sqlite-backup.ts";

const temporaryDirectories: string[] = [];

async function restoreFixture() {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-restore-missing-target-"),
  );
  temporaryDirectories.push(directory);
  const databasePath = join(directory, "quality-bar.sqlite3");
  const masterKey = Buffer.alloc(32, 7);
  const core = openDurableCore(databasePath);
  verifyInstallationKey(core, masterKey);
  bootstrapOperatorPassword(core, "the snapshot operator password");
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
  rmSync(databasePath);
  return { backup, databasePath, directory, masterKey };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("failed publication restores absence and retains the validated candidate", async () => {
  const { backup, databasePath, masterKey } = await restoreFixture();
  const commitFailure = Object.assign(new Error("directory fsync failed"), {
    code: "EIO",
  });
  let candidatePublished = false;
  let commitSyncFailed = false;
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
    (error) => {
      if (
        !(
          error instanceof Error &&
          "code" in error &&
          error.code === "restore_commit_failed_original_absent" &&
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

  assert.equal(existsSync(databasePath), false);
  assert.equal(existsSync(join(retainedPath, "quality-bar.sqlite3")), true);
});

test("an absent target remains recoverable at every publication crash boundary", async () => {
  for (const boundary of [
    "original-retained",
    "original-consolidated",
    "candidate-published",
    "publication-durable",
  ]) {
    const { backup, databasePath, directory, masterKey } =
      await restoreFixture();
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

    if (
      boundary === "candidate-published" ||
      boundary === "publication-durable"
    ) {
      const restored = openDurableCore(databasePath);
      restored.close();
    } else {
      assert.equal(existsSync(databasePath), false);
      const candidateDirectory = readdirSync(directory).find((name) =>
        name.startsWith(".quality-bar-restore-"),
      );
      if (!candidateDirectory) {
        throw new Error("restore_candidate_directory_missing");
      }
      const candidate = openDurableCore(
        join(directory, candidateDirectory, "quality-bar.sqlite3"),
      );
      candidate.close();
    }
  }
});
