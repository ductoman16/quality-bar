import { statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { configureDatabase, validateIntegrity } from "./durable-integrity.js";
import { failBackup, owningBackupError } from "./sqlite-backup-error.js";
import { createValidatedBackup } from "./sqlite-backup.js";
import {
  readValidatedBackups,
  retainLatestValidatedBackups,
} from "./validated-backup.js";

/** @param {string} databasePath */
function openBackupSource(databasePath) {
  let database;
  try {
    database = new DatabaseSync(databasePath);
  } catch (error) {
    throw owningBackupError(
      error,
      "sqlite_open_failed",
      "SQLite database could not be opened",
    );
  }
  try {
    configureDatabase(database);
    validateIntegrity(database);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

/** @param {string} databasePath */
function backupSourceExists(databasePath) {
  try {
    if (!statSync(databasePath).isFile()) {
      failBackup("sqlite_source_invalid", "SQLite backup source is not a file");
    }
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw owningBackupError(
      error,
      "sqlite_source_status_failed",
      "SQLite backup source status could not be read",
    );
  }
}

/**
 * @param {{
 *   applicationVersion: string,
 *   backupsPath: string,
 *   databasePath: string,
 *   keyIdentity: string,
 *   now?: () => number,
 *   targetSchemaVersion: number,
 * }} input
 */
export async function preparePreMigrationBackup({
  applicationVersion,
  backupsPath,
  databasePath,
  keyIdentity,
  now,
  targetSchemaVersion,
}) {
  if (!backupSourceExists(databasePath)) {
    return null;
  }
  const database = openBackupSource(databasePath);
  try {
    const schemaVersion = /** @type {{ user_version: number }} */ (
      database.prepare("PRAGMA user_version").get()
    ).user_version;
    if (
      !Number.isSafeInteger(schemaVersion) ||
      schemaVersion <= 0 ||
      schemaVersion >= targetSchemaVersion
    ) {
      return null;
    }
    return await createValidatedBackup({
      applicationVersion,
      backupsPath,
      database,
      keyIdentity,
      kind: "pre-migration",
      now,
    });
  } finally {
    database.close();
  }
}

/** @param {string} backupsPath */
export function finalizePreMigrationBackup(backupsPath) {
  return retainLatestValidatedBackups({
    backupsPath,
    keep: 1,
    kind: "pre-migration",
  });
}

/**
 * @param {{
 *   applicationVersion: string,
 *   backupsPath: string,
 *   databasePath: string,
 *   keyIdentity: string,
 *   now?: () => number,
 * }} input
 */
export async function runDailyBackupIfDue({
  applicationVersion,
  backupsPath,
  databasePath,
  keyIdentity,
  now = () => Date.now(),
}) {
  const timestamp = now();
  const utcDate = new Date(timestamp).toISOString().slice(0, 10);
  const current = readValidatedBackups({
    backupsPath,
    kind: "daily",
  }).find(
    (backup) =>
      backup.createdAt.slice(0, 10) === utcDate &&
      backup.keyIdentity === keyIdentity,
  );
  if (current) {
    return { status: "current" };
  }
  const database = openBackupSource(databasePath);
  try {
    const backup = await createValidatedBackup({
      applicationVersion,
      backupsPath,
      database,
      keyIdentity,
      kind: "daily",
      now: () => timestamp,
    });
    return { backup, status: "created" };
  } finally {
    database.close();
  }
}
