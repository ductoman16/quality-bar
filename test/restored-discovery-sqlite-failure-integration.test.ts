import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("discovery reset failure leaves the pre-restore database authoritative", async () => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-restore-failure-"));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, "quality-bar.sqlite3");
  const masterKey = Buffer.alloc(32, 7);
  const snapshot = openDurableCore(databasePath);
  verifyInstallationKey(snapshot, masterKey);
  bootstrapOperatorPassword(snapshot, "the snapshot operator password");
  snapshot.close();
  const source = new DatabaseSync(databasePath);
  const backup = await createValidatedBackup({
    applicationVersion: "0.1.0",
    backupsPath: join(directory, "backups"),
    database: source,
    keyIdentity: installationKeyIdentity(masterKey),
    kind: "daily",
  });
  source.close();
  const current = openDurableCore(databasePath);
  current.run(
    "INSERT INTO quality_bar_metadata (key, value) VALUES ('post_backup_fact', 'preserved-on-failure')",
  );
  current.close();
  const original = readFileSync(databasePath);

  await assert.rejects(
    restoreOfflineBackup({
      applicationVersion: "0.1.0",
      databasePath,
      manifestPath: backup.manifestPath,
      masterKey,
      operatorPassword: "the restored operator password",
      requireDiscoveryBaseline(core) {
        (core as any).run("SELECT missing_restore_discovery_sqlite_function()");
      },
    }),
    (error) =>
      error instanceof Error &&
      (error as Error & { code?: unknown }).code === "ERR_SQLITE_ERROR" &&
      error.message.includes("missing_restore_discovery_sqlite_function"),
  );

  assert.deepEqual(readFileSync(databasePath), original);
});
