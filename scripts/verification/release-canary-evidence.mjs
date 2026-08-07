import { dirname } from "node:path";

import { removeOwnedFile } from "../../src/review-run-submission-file-cleanup.js";
import {
  captureParent,
  fsyncDirectory,
  hasDurableJsonTransaction,
  isMissingPath,
  matchesIdentity,
  matchesSnapshot,
  normalizeFailure,
  readBoundJson,
  recoverDurableJson,
  requireParent,
  requirePathIdentity,
  writeDurableJson,
} from "./release-canary-files.mjs";
import {
  acquireReleaseCanaryManifestLock,
  requireReleaseCanaryManifestUnlocked,
} from "./release-canary-manifest-lock.mjs";

export { writeDurableJson } from "./release-canary-files.mjs";

/** @param {string} manifestPath */
export function readReleaseCanaryEvidence(manifestPath) {
  const parentIdentity = captureParent(manifestPath);
  requireReleaseCanaryManifestUnlocked(manifestPath, parentIdentity);
  const manifest = readBoundJson(manifestPath, parentIdentity);
  requireReleaseCanaryManifestUnlocked(manifestPath, parentIdentity);
  return manifest.value;
}

/** @param {{allowMissing?: boolean, beforeUpdate?: () => void, manifestPath: string, update: (manifest: any) => any}} input */
function updateEvidenceManifest({
  allowMissing = false,
  beforeUpdate,
  manifestPath,
  update,
}) {
  const parentIdentity = captureParent(manifestPath);
  const lockPath = `${manifestPath}.release-canary.lock`;
  let lockIdentity;
  let manifest = null;
  let replacement;
  let publishedManifestIdentity = null;
  let replacementPublished = false;
  let externalPublicationStarted = false;
  /** @type {Error | null} */
  let operationFailure = null;
  /** @type {Error[]} */
  const cleanupFailures = [];
  try {
    if (hasDurableJsonTransaction(manifestPath)) {
      lockIdentity = acquireReleaseCanaryManifestLock(
        lockPath,
        parentIdentity,
      ).identity;
      requireParent(lockPath, parentIdentity);
      requirePathIdentity(lockPath, lockIdentity);
      recoverDurableJson(manifestPath, parentIdentity);
    }
    try {
      manifest = readBoundJson(manifestPath, parentIdentity);
    } catch (error) {
      if (!isMissingPath(error)) {
        throw error;
      }
      lockIdentity ??= acquireReleaseCanaryManifestLock(
        lockPath,
        parentIdentity,
      ).identity;
      requireParent(lockPath, parentIdentity);
      requirePathIdentity(lockPath, lockIdentity);
      recoverDurableJson(manifestPath, parentIdentity);
      try {
        manifest = readBoundJson(manifestPath, parentIdentity);
      } catch (recoveredError) {
        if (!allowMissing || !isMissingPath(recoveredError)) {
          throw recoveredError;
        }
        manifest = null;
      }
    }
    replacement = update(manifest?.value ?? null);
    requireParent(manifestPath, parentIdentity);
    requirePathIdentity(manifestPath, manifest?.identity ?? null);
    lockIdentity ??= acquireReleaseCanaryManifestLock(
      lockPath,
      parentIdentity,
    ).identity;
    requireParent(lockPath, parentIdentity);
    requirePathIdentity(lockPath, lockIdentity);
    recoverDurableJson(manifestPath, parentIdentity);
    if (manifest === null) {
      requirePathIdentity(manifestPath, null);
    } else {
      const lockedManifest = readBoundJson(manifestPath, parentIdentity);
      if (
        !matchesIdentity(manifest.identity, lockedManifest.identity) ||
        !matchesSnapshot(manifest.snapshot, lockedManifest.snapshot)
      ) {
        throw new TypeError("release canary manifest identity changed");
      }
    }
    requireParent(lockPath, parentIdentity);
    requirePathIdentity(lockPath, lockIdentity);
    if (beforeUpdate) {
      externalPublicationStarted = true;
      beforeUpdate();
    }
    publishedManifestIdentity = writeDurableJson(
      manifestPath,
      replacement,
      manifest?.identity ?? null,
      parentIdentity,
      manifest?.snapshot ?? null,
    );
    replacementPublished = true;
  } catch (error) {
    operationFailure = normalizeFailure(
      error,
      "release canary manifest update failed",
    );
  }
  const retainManifestFence = Boolean(
    operationFailure &&
    (("releaseCanaryManifestFenced" in operationFailure &&
      operationFailure.releaseCanaryManifestFenced === true) ||
      externalPublicationStarted),
  );
  if (lockIdentity && !retainManifestFence) {
    try {
      requireParent(lockPath, parentIdentity);
      requirePathIdentity(lockPath, lockIdentity);
      if (!removeOwnedFile(lockPath, lockIdentity)) {
        throw new TypeError("release canary manifest lock identity changed");
      }
      fsyncDirectory(dirname(lockPath), parentIdentity);
    } catch (error) {
      cleanupFailures.push(
        normalizeFailure(error, "release canary manifest lock cleanup failed"),
      );
    }
  }
  if (
    operationFailure === null &&
    replacementPublished &&
    cleanupFailures.length > 0
  ) {
    let publishedManifest = null;
    try {
      publishedManifest = readBoundJson(manifestPath, parentIdentity);
      if (
        publishedManifestIdentity === null ||
        !matchesIdentity(
          publishedManifestIdentity,
          publishedManifest.identity,
        ) ||
        JSON.stringify(publishedManifest.value) !== JSON.stringify(replacement)
      ) {
        throw new TypeError("release canary manifest changed before rollback");
      }
      if (manifest === null) {
        if (!removeOwnedFile(manifestPath, publishedManifest.identity)) {
          throw new TypeError(
            "release canary manifest rollback ownership changed",
          );
        }
        fsyncDirectory(dirname(manifestPath), parentIdentity);
      } else {
        writeDurableJson(
          manifestPath,
          manifest.value,
          publishedManifest.identity,
          parentIdentity,
          publishedManifest.snapshot,
        );
      }
    } catch (error) {
      cleanupFailures.push(
        normalizeFailure(error, "release canary manifest rollback failed"),
      );
      if (publishedManifest !== null) {
        try {
          const current = readBoundJson(manifestPath, parentIdentity);
          if (
            publishedManifestIdentity !== null &&
            matchesIdentity(publishedManifestIdentity, current.identity) &&
            JSON.stringify(current.value) === JSON.stringify(replacement) &&
            matchesIdentity(current.identity, publishedManifest.identity)
          ) {
            if (!removeOwnedFile(manifestPath, current.identity)) {
              throw new TypeError(
                "release canary failed publication ownership changed",
              );
            }
            fsyncDirectory(dirname(manifestPath), parentIdentity);
          }
        } catch (removalFailure) {
          cleanupFailures.push(
            normalizeFailure(
              removalFailure,
              "release canary failed publication cleanup failed",
            ),
          );
        }
      }
    }
  }
  if (operationFailure && cleanupFailures.length > 0) {
    Object.defineProperty(operationFailure, "releaseCanaryCleanupFailures", {
      configurable: true,
      enumerable: false,
      value: cleanupFailures,
    });
    throw operationFailure;
  }
  if (operationFailure) {
    throw operationFailure;
  }
  if (cleanupFailures.length > 0) {
    throw new AggregateError(
      cleanupFailures,
      "release canary manifest lock cleanup failed",
    );
  }
}

/**
 * @param {{beforeUpdate?: () => void, canary: any, manifestPath: string, mergeEvidence: (manifest: any, canary: any) => any}} input
 */
export function updateReleaseCanaryEvidence({
  beforeUpdate,
  canary,
  manifestPath,
  mergeEvidence,
}) {
  updateEvidenceManifest({
    beforeUpdate,
    manifestPath,
    update: (manifest) => mergeEvidence(manifest, canary),
  });
}

/**
 * @param {{manifest: any, manifestPath: string, mergeEvidence: (current: any, manifest: any) => any}} input
 */
export function updateVerificationEvidence({
  manifest,
  manifestPath,
  mergeEvidence,
}) {
  updateEvidenceManifest({
    allowMissing: true,
    manifestPath,
    update: (current) => mergeEvidence(current, manifest),
  });
}
