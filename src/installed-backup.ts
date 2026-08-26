import { DatabaseSync } from "node:sqlite";

import {
  configureDatabase,
  validateIntegrity,
} from "./durable/durable-integrity.ts";
import { owningBackupError } from "./sqlite-backup-error.ts";
import { createValidatedBackup } from "./sqlite-backup.ts";
import { readValidatedBackups } from "./validated-backup.ts";

function openBackupSource(databasePath: string) {
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

export async function runDailyBackupIfDue({
  applicationVersion,
  backupsPath,
  databasePath,
  keyIdentity,
  now = () => Date.now(),
  signal,
}: {
  applicationVersion: string;
  backupsPath: string;
  databasePath: string;
  keyIdentity: string;
  now?: () => number;
  signal?: AbortSignal;
}) {
  signal?.throwIfAborted();
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
  signal?.throwIfAborted();
  const database = openBackupSource(databasePath);
  try {
    const backup = await createValidatedBackup({
      applicationVersion,
      backupsPath,
      database,
      keyIdentity,
      kind: "daily",
      now: () => timestamp,
      signal,
    });
    signal?.throwIfAborted();
    return { backup, status: "created" };
  } finally {
    database.close();
  }
}
