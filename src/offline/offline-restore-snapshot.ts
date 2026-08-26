import {
  copyFileSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { failRestore, owningRestoreError } from "./offline-restore-error.ts";
import {
  CURRENT_SCHEMA_DEFINITION,
  schemaDefinition,
} from "./offline-restore-schema.ts";
import { installationKeyIdentity } from "../sqlite-backup.ts";

const MANIFEST_NAME = /^quality-bar-(daily|pre-migration)-(.+)\.json$/;

function requireRegularFile(path: string, code: string, message: string) {
  let status;
  try {
    status = lstatSync(path);
  } catch (error) {
    throw owningRestoreError(error, code, message);
  }
  if (!status.isFile() || status.isSymbolicLink()) {
    failRestore(code, message);
  }
}

function readManifest(manifestPath: string) {
  requireRegularFile(
    manifestPath,
    "restore_manifest_invalid",
    "Restore manifest is not a regular file",
  );
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    failRestore(
      "restore_manifest_invalid",
      "Restore manifest is invalid",
      error,
    );
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    failRestore("restore_manifest_invalid", "Restore manifest is invalid");
  }
  return manifest as Record<string, unknown>;
}

export function validateRestoreSnapshot({
  applicationVersion,
  manifestPath,
  masterKey,
}: {
  applicationVersion: string;
  manifestPath: string;
  masterKey: Buffer;
}) {
  if (!/^\d+\.\d+\.\d+$/.test(applicationVersion)) {
    throw new TypeError("Application version must be semantic");
  }
  const manifestName = basename(manifestPath);
  const nameMatch = MANIFEST_NAME.exec(manifestName);
  const manifest = readManifest(manifestPath);
  if (
    !nameMatch ||
    manifest.kind !== nameMatch[1] ||
    manifest.database_file !== manifestName.replace(/\.json$/, ".sqlite3") ||
    typeof manifest.application_version !== "string" ||
    !/^\d+\.\d+\.\d+$/.test(manifest.application_version) ||
    typeof manifest.installation_key_identity !== "string" ||
    !/^sha256:[0-9a-f]{64}$/.test(manifest.installation_key_identity) ||
    typeof manifest.created_at !== "string" ||
    Number.isNaN(Date.parse(manifest.created_at)) ||
    new Date(manifest.created_at).toISOString() !== manifest.created_at
  ) {
    failRestore("restore_manifest_invalid", "Restore manifest is invalid");
  }
  if (manifest.application_version !== applicationVersion) {
    failRestore(
      "restore_application_incompatible",
      `Restore snapshot application version ${String(manifest.application_version)} is incompatible with ${applicationVersion}`,
    );
  }
  const keyIdentity = installationKeyIdentity(masterKey);
  if (manifest.installation_key_identity !== keyIdentity) {
    failRestore(
      "restore_key_identity_mismatch",
      "Restore snapshot requires a different installation key",
    );
  }
  const snapshotPath = join(
    dirname(manifestPath),
    manifest.database_file as string,
  );
  requireRegularFile(
    snapshotPath,
    "restore_snapshot_invalid",
    "Restore snapshot is not a regular file",
  );
  let snapshot;
  try {
    snapshot = new DatabaseSync(snapshotPath, { readOnly: true });
    const integrity = snapshot
      .prepare("PRAGMA integrity_check")
      .get()?.integrity_check;
    if (integrity !== "ok") {
      failRestore(
        "restore_snapshot_integrity_invalid",
        `Restore snapshot integrity check returned ${String(integrity)}`,
      );
    }
    if (snapshot.prepare("PRAGMA foreign_key_check").get()) {
      failRestore(
        "restore_snapshot_integrity_invalid",
        "Restore snapshot foreign-key check found a violation",
      );
    }
  } catch (error) {
    if (error instanceof Error && error.name === "OfflineRestoreError") {
      throw error;
    }
    failRestore(
      "restore_snapshot_integrity_invalid",
      "Restore snapshot integrity could not be validated",
      error,
    );
  } finally {
    snapshot?.close();
  }
  return {
    applicationVersion,
    snapshotPath,
  };
}

export function copyRestoreCandidate(
  databasePath: string,
  snapshotPath: string,
  {
    copy = copyFileSync,
    makeDirectory = mkdtempSync,
    remove = rmSync,
  }: {
    copy?: (source: string, destination: string) => void;
    makeDirectory?: (prefix: string) => string;
    remove?: (
      path: string,
      options: { force: boolean; recursive: boolean },
    ) => void;
  } = {},
) {
  let directory;
  try {
    directory = makeDirectory(
      join(dirname(databasePath), ".quality-bar-restore-"),
    );
    const candidatePath = join(directory, "quality-bar.sqlite3");
    copy(snapshotPath, candidatePath);
    return { candidatePath, directory };
  } catch (error) {
    if (directory) {
      try {
        remove(directory, { force: true, recursive: true });
      } catch (cleanupError) {
        failRestore(
          "restore_candidate_create_failed",
          "Restore candidate creation and cleanup both failed",
          new AggregateError([error, cleanupError]),
        );
      }
    }
    failRestore(
      "restore_candidate_create_failed",
      "Restore candidate could not be created",
      error,
    );
  }
}

export function validateRestoreCandidate(candidatePath: string) {
  let candidate;
  try {
    candidate = new DatabaseSync(candidatePath, { readOnly: true });
    const integrity = candidate
      .prepare("PRAGMA integrity_check")
      .get()?.integrity_check;
    const foreignKeyViolation = candidate
      .prepare("PRAGMA foreign_key_check")
      .get();
    if (
      integrity !== "ok" ||
      foreignKeyViolation ||
      JSON.stringify(schemaDefinition(candidate)) !== CURRENT_SCHEMA_DEFINITION
    ) {
      failRestore(
        "restore_candidate_schema_invalid",
        "Copied restore candidate does not have the complete current schema",
      );
    }
  } catch (error) {
    if (error instanceof Error && error.name === "OfflineRestoreError") {
      throw error;
    }
    failRestore(
      "restore_candidate_schema_invalid",
      "Copied restore candidate schema could not be validated",
      error,
    );
  } finally {
    candidate?.close();
  }
}
