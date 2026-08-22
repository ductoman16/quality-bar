import {
  copyFileSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { SCHEMA_VERSION } from "../durable/durable-schema.js";
import { failRestore, owningRestoreError } from "./offline-restore-error.js";
import {
  CURRENT_SCHEMA_DEFINITION,
  schemaDefinition,
} from "./offline-restore-schema.js";
import { installationKeyIdentity } from "../sqlite-backup.js";

const MANIFEST_NAME = /^quality-bar-(daily|pre-migration)-(.+)\.json$/;

/** @param {string} path @param {string} code @param {string} message */
function requireRegularFile(path, code, message) {
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

/** @param {string} manifestPath */
function readManifest(manifestPath) {
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
  return /** @type {Record<string, unknown>} */ (manifest);
}

/**
 * @param {{
 *   applicationVersion: string,
 *   manifestPath: string,
 *   masterKey: Buffer,
 * }} input
 */
export function validateRestoreSnapshot({
  applicationVersion,
  manifestPath,
  masterKey,
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
    !Number.isSafeInteger(manifest.schema_version) ||
    Number(manifest.schema_version) <= 0 ||
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
  if (manifest.schema_version !== SCHEMA_VERSION) {
    failRestore(
      "restore_schema_incompatible",
      `Restore snapshot schema version ${String(manifest.schema_version)} is incompatible with ${SCHEMA_VERSION}`,
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
    /** @type {string} */ (manifest.database_file),
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
    const schemaVersion = snapshot
      .prepare("PRAGMA user_version")
      .get()?.user_version;
    if (schemaVersion !== manifest.schema_version) {
      failRestore(
        "restore_snapshot_integrity_invalid",
        "Restore snapshot schema does not match its manifest",
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
    schemaVersion: SCHEMA_VERSION,
    snapshotPath,
  };
}

/**
 * @param {string} databasePath
 * @param {string} snapshotPath
 * @param {{
 *   copy?: (source: string, destination: string) => void,
 *   makeDirectory?: (prefix: string) => string,
 *   remove?: (path: string, options: {force: boolean, recursive: boolean}) => void,
 * }} [operations]
 */
export function copyRestoreCandidate(
  databasePath,
  snapshotPath,
  { copy = copyFileSync, makeDirectory = mkdtempSync, remove = rmSync } = {},
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

/** @param {string} candidatePath */
export function validateRestoreCandidate(candidatePath) {
  let candidate;
  try {
    candidate = new DatabaseSync(candidatePath, { readOnly: true });
    const integrity = candidate
      .prepare("PRAGMA integrity_check")
      .get()?.integrity_check;
    const schemaVersion = candidate
      .prepare("PRAGMA user_version")
      .get()?.user_version;
    const foreignKeyViolation = candidate
      .prepare("PRAGMA foreign_key_check")
      .get();
    if (
      integrity !== "ok" ||
      foreignKeyViolation ||
      schemaVersion !== SCHEMA_VERSION ||
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
