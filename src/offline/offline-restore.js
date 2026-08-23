import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  openSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { openDurableCore } from "../durable/durable-core.js";
import { isSqliteCorruption } from "../durable/durable-integrity.js";
import { verifyRestoredInstallationKey } from "../installation-configuration.js";
import {
  copyRestoreCandidate,
  validateRestoreCandidate,
  validateRestoreSnapshot,
} from "./offline-restore-snapshot.js";
import { failRestore, failRetainedRestore } from "./offline-restore-error.js";
import { validateRestoredCredentials } from "./offline-restore-state.js";
import { replaceRestoredOperatorAuthority } from "../operator/operator-password.js";
import { requireRestoredDiscoveryBaseline } from "../restored-discovery.js";

/** @param {string} path */
function synchronize(path) {
  const descriptor = openSync(path, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

/** @param {string} databasePath */
function consolidateStoppedDatabase(databasePath) {
  const database = new DatabaseSync(databasePath);
  try {
    const checkpoint = database
      .prepare("PRAGMA wal_checkpoint(TRUNCATE)")
      .get();
    if (
      checkpoint?.busy !== 0 ||
      checkpoint?.log !== checkpoint?.checkpointed
    ) {
      failRestore(
        "restore_original_checkpoint_failed",
        "Stopped installation database could not be consolidated",
      );
    }
  } finally {
    database.close();
  }
}

/**
 * @param {string} candidatePath
 * @param {string} databasePath
 * @param {{
 *   checkpoint?: (path: string) => void,
 *   exists?: (path: string) => boolean,
 *   link?: (existingPath: string, newPath: string) => void,
 *   publicationBoundary?: (boundary: "original-consolidated" | "original-retained" | "candidate-published" | "publication-durable") => void,
 *   removeFile?: (path: string, options: {force: boolean}) => void,
 *   removeDirectory?: (path: string, options: {force: boolean, recursive: boolean}) => void,
 *   rename?: (from: string, to: string) => void,
 *   synchronizePath?: (path: string) => void,
 * }} [operations]
 */
function commitRestoreCandidate(
  candidatePath,
  databasePath,
  {
    checkpoint = consolidateStoppedDatabase,
    exists = existsSync,
    link = linkSync,
    publicationBoundary = () => {},
    removeFile = rmSync,
    removeDirectory = rmSync,
    rename = renameSync,
    synchronizePath = synchronize,
  } = {},
) {
  const preservedPath = `${candidatePath}.previous-0`;
  const sidecars = [`${databasePath}-wal`, `${databasePath}-shm`].map(
    (original, index) => ({
      original,
      preserved: `${candidatePath}.previous-${index + 1}`,
    }),
  );
  const originalPresent = exists(databasePath);
  let candidateCommitted = false;
  let opaqueOriginal = false;
  try {
    if (originalPresent) {
      link(databasePath, preservedPath);
    }
    for (const sidecar of sidecars.filter(({ original }) => exists(original))) {
      link(sidecar.original, sidecar.preserved);
    }
    synchronizePath(dirname(candidatePath));
    publicationBoundary("original-retained");
    let checkpointed = false;
    if (originalPresent) {
      try {
        checkpoint(databasePath);
        checkpointed = true;
      } catch (error) {
        if (error instanceof Error && error.name === "OfflineRestoreError") {
          throw error;
        }
        if (!isSqliteCorruption(error)) {
          throw error;
        }
        opaqueOriginal = true;
      }
    }
    for (const sidecar of sidecars) {
      removeFile(sidecar.original, { force: true });
      if (checkpointed) {
        removeFile(sidecar.preserved, { force: true });
      }
    }
    if (originalPresent) {
      synchronizePath(databasePath);
    }
    synchronizePath(dirname(databasePath));
    synchronizePath(dirname(candidatePath));
    publicationBoundary("original-consolidated");
    rename(candidatePath, databasePath);
    candidateCommitted = true;
    publicationBoundary("candidate-published");
    synchronizePath(dirname(databasePath));
    publicationBoundary("publication-durable");
  } catch (error) {
    const rollbackFailures = [];
    if (!originalPresent) {
      if (candidateCommitted) {
        try {
          link(databasePath, candidatePath);
          removeFile(databasePath, { force: true });
        } catch (rollbackError) {
          rollbackFailures.push(rollbackError);
        }
      }
      try {
        synchronizePath(dirname(databasePath));
        synchronizePath(dirname(candidatePath));
      } catch (rollbackError) {
        rollbackFailures.push(rollbackError);
      }
      if (rollbackFailures.length > 0) {
        failRetainedRestore(
          "restore_commit_rollback_failed",
          "Restore commit and rollback both failed",
          dirname(candidatePath),
          new AggregateError([error, ...rollbackFailures]),
        );
      }
      failRetainedRestore(
        "restore_commit_failed_original_absent",
        "Restore publication failed while the original database was absent",
        dirname(candidatePath),
        error,
      );
    }
    if (!candidateCommitted && opaqueOriginal) {
      failRetainedRestore(
        "restore_original_preservation_failed",
        "Unreadable stopped installation could not be safely replaced",
        dirname(candidatePath),
        error,
      );
    }
    if (candidateCommitted) {
      try {
        link(databasePath, candidatePath);
      } catch (rollbackError) {
        rollbackFailures.push(rollbackError);
      }
      try {
        rename(preservedPath, databasePath);
      } catch (rollbackError) {
        rollbackFailures.push(rollbackError);
      }
      for (const sidecar of sidecars) {
        if (!exists(sidecar.preserved)) {
          continue;
        }
        try {
          link(sidecar.preserved, sidecar.original);
        } catch (rollbackError) {
          rollbackFailures.push(rollbackError);
        }
      }
    }
    try {
      synchronizePath(dirname(databasePath));
      synchronizePath(dirname(candidatePath));
    } catch (rollbackError) {
      rollbackFailures.push(rollbackError);
    }
    if (rollbackFailures.length > 0) {
      failRetainedRestore(
        "restore_commit_rollback_failed",
        "Restore commit and rollback both failed",
        dirname(candidatePath),
        new AggregateError([error, ...rollbackFailures]),
      );
    }
    throw error;
  }
  try {
    removeDirectory(dirname(candidatePath), { force: true, recursive: true });
  } catch (error) {
    failRetainedRestore(
      "restore_previous_state_cleanup_failed",
      "Restore committed but previous state cleanup failed",
      dirname(candidatePath),
      error,
      true,
    );
  }
}

/**
 * @param {{
 *   applicationVersion: string,
 *   databasePath: string,
 *   manifestPath: string,
 *   masterKey: Buffer,
 *   operatorPassword: unknown,
 *   recoverAuthority?: typeof replaceRestoredOperatorAuthority,
 *   requireDiscoveryBaseline?: typeof requireRestoredDiscoveryBaseline,
 *   copyOperations?: Parameters<typeof copyRestoreCandidate>[2],
 *   commitOperations?: Parameters<typeof commitRestoreCandidate>[2],
 * }} input
 */
export async function restoreOfflineBackup({
  applicationVersion,
  databasePath,
  manifestPath,
  masterKey,
  operatorPassword,
  recoverAuthority = replaceRestoredOperatorAuthority,
  requireDiscoveryBaseline = requireRestoredDiscoveryBaseline,
  copyOperations,
  commitOperations,
}) {
  const snapshot = validateRestoreSnapshot({
    applicationVersion,
    manifestPath,
    masterKey,
  });
  const candidate = copyRestoreCandidate(
    databasePath,
    snapshot.snapshotPath,
    copyOperations,
  );
  let core;
  /** @type {unknown} */
  let primaryFailure;
  let retainedCandidate = false;
  try {
    validateRestoreCandidate(candidate.candidatePath);
    core = openDurableCore(candidate.candidatePath);
    verifyRestoredInstallationKey(core, masterKey);
    validateRestoredCredentials(core, masterKey);
    recoverAuthority(core, operatorPassword);
    requireDiscoveryBaseline(core);
    core.get("PRAGMA wal_checkpoint(TRUNCATE)");
    core.close();
    core = undefined;
    rmSync(`${candidate.candidatePath}-wal`, { force: true });
    rmSync(`${candidate.candidatePath}-shm`, { force: true });
    synchronize(candidate.candidatePath);
    commitRestoreCandidate(
      candidate.candidatePath,
      databasePath,
      commitOperations,
    );
    return {
      applicationVersion: snapshot.applicationVersion,
      schemaVersion: snapshot.schemaVersion,
      status: "restored",
    };
  } catch (error) {
    primaryFailure = error;
    retainedCandidate =
      error instanceof Error &&
      "retainedPath" in error &&
      error.retainedPath === candidate.directory;
    throw error;
  } finally {
    const cleanupFailures = [];
    try {
      core?.close();
    } catch (error) {
      cleanupFailures.push(error);
    }
    if (!retainedCandidate) {
      try {
        rmSync(candidate.directory, { force: true, recursive: true });
      } catch (error) {
        cleanupFailures.push(error);
      }
    }
    if (cleanupFailures.length > 0) {
      if (primaryFailure instanceof Error) {
        primaryFailure.cause = new AggregateError(
          [
            ...(primaryFailure.cause === undefined
              ? []
              : [primaryFailure.cause]),
            ...cleanupFailures,
          ],
          "Restore failure and candidate cleanup both failed",
        );
      } else {
        failRestore(
          "restore_candidate_cleanup_failed",
          "Restore candidate cleanup failed",
          new AggregateError(cleanupFailures),
        );
      }
    }
  }
}
