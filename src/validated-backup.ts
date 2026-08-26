import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { isSqliteCorruption } from "./durable/durable-integrity.ts";
import { owningBackupError } from "./sqlite-backup-error.ts";

const BACKUP_FILE = /^quality-bar-(daily)-(.+)\.(json|sqlite3)$/;

export type BackupManifest = {
  application_version: string;
  created_at: string;
  database_file: string;
  installation_key_identity: string;
  kind: string;
};

function discard(paths: string[]) {
  if (paths.length === 0) {
    return;
  }
  try {
    for (const path of paths) {
      rmSync(path, { force: true });
    }
    const descriptor = openSync(dirname(paths[0]), "r");
    try {
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
  } catch (error) {
    throw owningBackupError(
      error,
      "backup_invalid_output_cleanup_failed",
      "Invalid SQLite backup output could not be discarded",
    );
  }
}

function fileExists(path: string) {
  try {
    return statSync(path).isFile();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw owningBackupError(
      error,
      "backup_output_status_failed",
      "SQLite backup output status could not be read",
    );
  }
}

function validatedManifest(
  manifest: unknown,
  kind: string,
  databaseFile: string,
): BackupManifest | null {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return null;
  }
  const record = manifest as Record<string, unknown>;
  if (
    record.kind !== kind ||
    record.database_file !== databaseFile ||
    typeof record.application_version !== "string" ||
    !/^\d+\.\d+\.\d+$/.test(record.application_version) ||
    typeof record.created_at !== "string" ||
    Number.isNaN(Date.parse(record.created_at)) ||
    new Date(record.created_at).toISOString() !== record.created_at ||
    typeof record.installation_key_identity !== "string" ||
    !/^sha256:[0-9a-f]{64}$/.test(record.installation_key_identity)
  ) {
    return null;
  }
  return record as BackupManifest;
}

function databaseIsValid(databasePath: string) {
  let database;
  let valid = false;
  let validationFailure;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    valid =
      database.prepare("PRAGMA integrity_check").get()?.integrity_check ===
      "ok";
  } catch (error) {
    if (!isSqliteCorruption(error)) {
      validationFailure = owningBackupError(
        error,
        "backup_validation_failed",
        "SQLite backup validation could not complete",
      );
    }
  }
  let cleanupFailure;
  try {
    database?.close();
    rmSync(`${databasePath}-wal`, { force: true });
    rmSync(`${databasePath}-shm`, { force: true });
  } catch (error) {
    cleanupFailure = owningBackupError(
      error,
      "backup_validation_cleanup_failed",
      "SQLite backup validation cleanup could not complete",
    );
  }
  if (validationFailure) {
    throw validationFailure;
  }
  if (cleanupFailure) {
    throw cleanupFailure;
  }
  return valid;
}

export function readValidatedBackups({
  backupsPath,
  kind,
}: {
  backupsPath: string;
  kind?: "daily";
}) {
  if (!fileExists(backupsPath) && !existsSync(backupsPath)) {
    return [];
  }
  let files;
  try {
    files = readdirSync(backupsPath);
  } catch (error) {
    throw owningBackupError(
      error,
      "backup_directory_read_failed",
      "SQLite backup directory could not be read",
    );
  }

  discard(
    files
      .filter(
        (file) =>
          file.startsWith(".quality-bar-") ||
          (file.startsWith("quality-bar-") &&
            (file.endsWith(".sqlite3-wal") || file.endsWith(".sqlite3-shm"))),
      )
      .map((file) => join(backupsPath, file)),
  );

  const manifests = new Set(
    files.filter((file) => BACKUP_FILE.exec(file)?.[3] === "json"),
  );
  const validated = [];
  for (const manifestFile of manifests) {
    const match = BACKUP_FILE.exec(manifestFile);
    if (!match) {
      continue;
    }
    const manifestKind = match[1];
    const databaseFile = manifestFile.replace(/\.json$/, ".sqlite3");
    const manifestPath = join(backupsPath, manifestFile);
    const databasePath = join(backupsPath, databaseFile);
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch (error) {
      if (!(error instanceof SyntaxError)) {
        throw owningBackupError(
          error,
          "backup_manifest_read_failed",
          "SQLite backup manifest could not be read",
        );
      }
      manifest = null;
    }
    manifest = validatedManifest(manifest, manifestKind, databaseFile);
    if (
      !manifest ||
      !fileExists(databasePath) ||
      !databaseIsValid(databasePath)
    ) {
      discard([
        manifestPath,
        databasePath,
        `${databasePath}-wal`,
        `${databasePath}-shm`,
      ]);
      continue;
    }
    validated.push({
      applicationVersion: manifest.application_version,
      createdAt: manifest.created_at,
      databasePath,
      keyIdentity: manifest.installation_key_identity,
      kind: manifestKind,
      manifestPath,
    });
  }

  for (const file of files) {
    const match = BACKUP_FILE.exec(file);
    if (
      match?.[3] === "sqlite3" &&
      !manifests.has(file.replace(/\.sqlite3$/, ".json"))
    ) {
      const databasePath = join(backupsPath, file);
      discard([databasePath, `${databasePath}-wal`, `${databasePath}-shm`]);
    }
  }
  return kind ? validated.filter((backup) => backup.kind === kind) : validated;
}

export function retainLatestValidatedBackups({
  backupsPath,
  keep,
  kind,
}: {
  backupsPath: string;
  keep: number;
  kind: "daily";
}) {
  const validated = readValidatedBackups({ backupsPath, kind }).sort(
    (left, right) => right.createdAt.localeCompare(left.createdAt),
  );
  const expired = validated.slice(keep);
  try {
    for (const backup of expired) {
      rmSync(backup.databasePath);
      rmSync(backup.manifestPath);
    }
    if (expired.length > 0) {
      const descriptor = openSync(backupsPath, "r");
      try {
        fsyncSync(descriptor);
      } finally {
        closeSync(descriptor);
      }
    }
  } catch (error) {
    throw owningBackupError(
      error,
      "backup_retention_failed",
      "Successful SQLite backup retention could not complete",
    );
  }
  return validated.slice(0, keep);
}
