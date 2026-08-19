import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

import { isSqliteCorruption } from "./durable-integrity.js";
import { failBackup, owningBackupError } from "./sqlite-backup-error.js";
import {
  readValidatedBackups,
  retainLatestValidatedBackups,
} from "./validated-backup.js";

export { SqliteBackupError } from "./sqlite-backup-error.js";

/** @param {Buffer} masterKey */
export function installationKeyIdentity(masterKey) {
  if (!Buffer.isBuffer(masterKey) || masterKey.length !== 32) {
    throw new TypeError("Installation master key must contain 32 bytes");
  }
  return `sha256:${createHash("sha256")
    .update("quality-bar-installation-key-identity-v1\0", "utf8")
    .update(masterKey)
    .digest("hex")}`;
}

/** @param {number} timestamp */
function backupTimestamp(timestamp) {
  const createdAt = new Date(timestamp);
  if (!Number.isFinite(timestamp) || Number.isNaN(createdAt.valueOf())) {
    throw new TypeError("Backup time must be valid");
  }
  return {
    createdAt: createdAt.toISOString(),
    fileTimestamp: createdAt
      .toISOString()
      .replace(/\.(\d{3})Z$/, "-$1Z")
      .replaceAll(":", "-"),
  };
}

/** @param {string} path */
function synchronize(path) {
  const descriptor = openSync(path, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

/**
 * @param {{
 *   applicationVersion: string,
 *   backupsPath: string,
 *   database: DatabaseSync,
 *   keyIdentity: string,
 *   kind: "daily",
 *   now?: () => number,
 *   performBackup?: typeof backup,
 *   removeBackupOutput?: typeof rmSync,
 *   signal?: AbortSignal,
 * }} input
 */
export async function createValidatedBackup({
  applicationVersion,
  backupsPath,
  database,
  keyIdentity,
  kind,
  now = () => Date.now(),
  performBackup = backup,
  removeBackupOutput = rmSync,
  signal,
}) {
  if (!/^\d+\.\d+\.\d+$/.test(applicationVersion)) {
    throw new TypeError("Application version must be semantic");
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(keyIdentity)) {
    throw new TypeError("Installation key identity must be a SHA-256 digest");
  }
  if (kind !== "daily") {
    throw new TypeError("Backup kind is unsupported");
  }

  const { createdAt, fileTimestamp } = backupTimestamp(now());
  const stem = `quality-bar-${kind}-${fileTimestamp}`;
  const databasePath = join(backupsPath, `${stem}.sqlite3`);
  const manifestPath = join(backupsPath, `${stem}.json`);
  const incompleteIdentity = randomUUID();
  const incompleteDatabasePath = join(
    backupsPath,
    `.${stem}.${incompleteIdentity}.sqlite3`,
  );
  const incompleteManifestPath = join(
    backupsPath,
    `.${stem}.${incompleteIdentity}.json`,
  );
  let validatedDatabase;
  let databaseCommitted = false;
  let manifestCommitted = false;

  try {
    signal?.throwIfAborted();
    mkdirSync(backupsPath, { recursive: true, mode: 0o700 });
    readValidatedBackups({ backupsPath });
    if (existsSync(databasePath) || existsSync(manifestPath)) {
      failBackup(
        "backup_destination_exists",
        "A backup already exists for this timestamp",
      );
    }

    await performBackup(database, incompleteDatabasePath, {
      progress: () => signal?.throwIfAborted(),
      rate: 100,
    });
    signal?.throwIfAborted();
    try {
      try {
        validatedDatabase = new DatabaseSync(incompleteDatabasePath, {
          readOnly: true,
        });
      } catch (error) {
        if (isSqliteCorruption(error)) {
          failBackup(
            "backup_integrity_check_failed",
            "SQLite backup is not valid",
            error,
          );
        }
        throw owningBackupError(
          error,
          "backup_integrity_check_failed",
          "SQLite backup integrity check could not complete",
        );
      }
      let integrity;
      try {
        integrity = /** @type {{ integrity_check?: unknown } | undefined} */ (
          validatedDatabase.prepare("PRAGMA integrity_check").get()
        )?.integrity_check;
      } catch (error) {
        if (isSqliteCorruption(error)) {
          failBackup(
            "backup_integrity_check_failed",
            "SQLite backup is not valid",
            error,
          );
        }
        throw owningBackupError(
          error,
          "backup_integrity_check_failed",
          "SQLite backup integrity check could not complete",
        );
      }
      if (integrity !== "ok") {
        failBackup(
          "backup_integrity_check_failed",
          `SQLite backup integrity check returned ${String(integrity)}`,
        );
      }
      const schemaVersion = /** @type {{ user_version: number }} */ (
        validatedDatabase.prepare("PRAGMA user_version").get()
      ).user_version;
      if (!Number.isSafeInteger(schemaVersion) || schemaVersion <= 0) {
        failBackup(
          "backup_schema_invalid",
          "SQLite backup schema version is invalid",
        );
      }
      validatedDatabase.close();
      validatedDatabase = undefined;
      rmSync(`${incompleteDatabasePath}-wal`, { force: true });
      rmSync(`${incompleteDatabasePath}-shm`, { force: true });

      const manifest = {
        application_version: applicationVersion,
        created_at: createdAt,
        database_file: basename(databasePath),
        installation_key_identity: keyIdentity,
        kind,
        schema_version: schemaVersion,
      };
      writeFileSync(
        incompleteManifestPath,
        `${JSON.stringify(manifest, null, 2)}\n`,
        { encoding: "utf8", flag: "wx", mode: 0o600 },
      );
      signal?.throwIfAborted();
      renameSync(incompleteDatabasePath, databasePath);
      databaseCommitted = true;
      renameSync(incompleteManifestPath, manifestPath);
      manifestCommitted = true;
      synchronize(databasePath);
      synchronize(manifestPath);
      synchronize(backupsPath);
      const result = {
        applicationVersion,
        createdAt,
        databasePath,
        keyIdentity,
        kind,
        manifestPath,
        schemaVersion,
      };
      if (kind === "daily") {
        retainLatestValidatedBackups({
          backupsPath,
          keep: 7,
          kind,
        });
        synchronize(backupsPath);
      }
      return result;
    } finally {
      validatedDatabase?.close();
    }
  } catch (error) {
    const cleanupFailures = [];
    for (const path of [
      incompleteDatabasePath,
      incompleteManifestPath,
      `${incompleteDatabasePath}-wal`,
      `${incompleteDatabasePath}-shm`,
      ...(databaseCommitted
        ? [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]
        : []),
      ...(manifestCommitted ? [manifestPath] : []),
    ]) {
      try {
        removeBackupOutput(path, { force: true });
      } catch (cleanupError) {
        cleanupFailures.push(cleanupError);
      }
    }
    if (
      signal?.aborted &&
      error === signal.reason &&
      cleanupFailures.length > 0
    ) {
      failBackup(
        "backup_invalid_output_cleanup_failed",
        "Canceled SQLite backup output could not be discarded",
        new AggregateError([error, ...cleanupFailures]),
      );
    }
    const failure =
      signal?.aborted && error === signal.reason
        ? /** @type {Error} */ (error)
        : owningBackupError(
            error,
            "backup_failed",
            "SQLite online backup could not complete",
          );
    if (cleanupFailures.length > 0) {
      failure.cause = new AggregateError(
        [failure.cause ?? failure, ...cleanupFailures],
        "SQLite backup and incomplete-output cleanup failed",
      );
    }
    throw failure;
  }
}
