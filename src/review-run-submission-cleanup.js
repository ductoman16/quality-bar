import { randomUUID } from "node:crypto";
import { lstatSync, renameSync, rmdirSync, rmSync } from "node:fs";

import { isMissingPath } from "./review-run-submission-files.js";

/** @param {string} path */
function pathExists(path) {
  try {
    return lstatSync(path).isFile();
  } catch (error) {
    if (isMissingPath(error)) {
      return false;
    }
    throw error;
  }
}

/**
 * @param {string} path
 * @param {{force: boolean, recursive: boolean}} options
 */
export function removeSubmissionDirectory(path, options) {
  if (options.recursive) {
    rmSync(path, options);
    return;
  }
  try {
    rmdirSync(path);
  } catch (error) {
    if (
      !(
        options.force &&
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      )
    ) {
      throw error;
    }
  }
}

/**
 * @param {{requestPath: string, lockPath: string, responsePath: string, acknowledgmentPath: string, closedPath: string}} paths
 */
export function hasSubmissionArtifacts(paths) {
  return [
    paths.requestPath,
    paths.lockPath,
    paths.responsePath,
    paths.acknowledgmentPath,
  ].some(pathExists);
}

/**
 * @param {{requestPath: string, lockPath: string, responsePath: string, acknowledgmentPath: string, closedPath: string}} paths
 * @param {{requestIdentity: {dev: number, ino: number} | null, lockIdentity: {dev: number, ino: number} | null, responseIdentity: {dev: number, ino: number} | null, acknowledgmentIdentity: {dev: number, ino: number} | null}} identities
 */
function hasOwnedSubmissionArtifacts(paths, identities) {
  /** @type {[string, {dev: number, ino: number} | null][]} */
  const artifacts = [
    [paths.requestPath, identities.requestIdentity],
    [paths.lockPath, identities.lockIdentity],
    [paths.responsePath, identities.responseIdentity],
    [paths.acknowledgmentPath, identities.acknowledgmentIdentity],
  ];
  return artifacts.some(
    ([path, identity]) => identity !== null && pathExists(path),
  );
}

/**
 * @param {unknown} failure
 * @param {unknown} cleanupFailure
 */
export function preserveCleanupFailure(failure, cleanupFailure) {
  if (failure instanceof Error) {
    Object.defineProperty(failure, "submissionCleanupFailure", {
      configurable: true,
      enumerable: false,
      value: cleanupFailure,
    });
  }
}

/** @param {unknown} failure */
function normalizeCleanupFailure(failure) {
  return failure instanceof Error
    ? failure
    : new TypeError("Review Run submission cleanup failed", {
        cause: failure,
      });
}

/**
 * @param {unknown} closeFailure
 * @param {unknown} cleanupFailure
 * @returns {unknown}
 */
export function mergeCleanupFailure(closeFailure, cleanupFailure) {
  const normalizedCleanupFailure = normalizeCleanupFailure(cleanupFailure);
  if (closeFailure !== null) {
    const normalizedCloseFailure = normalizeCleanupFailure(closeFailure);
    preserveCleanupFailure(normalizedCloseFailure, normalizedCleanupFailure);
    return normalizedCloseFailure;
  }
  return normalizedCleanupFailure;
}

/**
 * @param {string} path
 * @param {{dev: number, ino: number} | null} identity
 * @param {unknown} closeFailure
 * @param {(path: string, identity: {dev: number, ino: number}) => void} removeOwnedFile
 * @returns {unknown}
 */
export function cleanupOwnedFile(
  path,
  identity,
  closeFailure,
  removeOwnedFile,
) {
  if (!identity) {
    return closeFailure;
  }
  try {
    removeOwnedFile(path, identity);
    return closeFailure;
  } catch (cleanupFailure) {
    return mergeCleanupFailure(closeFailure, cleanupFailure);
  }
}

/**
 * @param {string} path
 * @param {{dev: number, ino: number, birthtimeMs: number, uid: number, gid: number}} identity
 * @param {unknown} closeFailure
 * @param {(path: string, options: {force: boolean, recursive: boolean}) => void} removeDirectory
 * @returns {unknown}
 */
export function cleanupOwnedDirectory(
  path,
  identity,
  closeFailure,
  removeDirectory,
) {
  let status;
  try {
    status = lstatSync(path);
  } catch (error) {
    if (isMissingPath(error)) {
      return closeFailure;
    }
    return mergeCleanupFailure(closeFailure, error);
  }
  if (
    !status.isDirectory() ||
    status.isSymbolicLink() ||
    status.dev !== identity.dev ||
    status.ino !== identity.ino ||
    status.birthtimeMs !== identity.birthtimeMs ||
    status.uid !== identity.uid ||
    status.gid !== identity.gid
  ) {
    return mergeCleanupFailure(
      closeFailure,
      new TypeError(
        "Review Run submission command directory ownership changed",
      ),
    );
  }
  const quarantinePath = `${path}.cleanup-${randomUUID()}`;
  try {
    renameSync(path, quarantinePath);
    const quarantined = lstatSync(quarantinePath);
    if (
      !quarantined.isDirectory() ||
      quarantined.isSymbolicLink() ||
      quarantined.dev !== identity.dev ||
      quarantined.ino !== identity.ino ||
      quarantined.birthtimeMs !== identity.birthtimeMs ||
      quarantined.uid !== identity.uid ||
      quarantined.gid !== identity.gid
    ) {
      try {
        renameSync(quarantinePath, path);
      } catch (restoreFailure) {
        return mergeCleanupFailure(closeFailure, restoreFailure);
      }
      return mergeCleanupFailure(
        closeFailure,
        new TypeError(
          "Review Run submission command directory ownership changed",
        ),
      );
    }
    try {
      removeDirectory(quarantinePath, { force: true, recursive: false });
      try {
        lstatSync(quarantinePath);
        renameSync(quarantinePath, path);
        throw new Error(
          "Review Run submission command directory was not removed",
        );
      } catch (verificationFailure) {
        if (!isMissingPath(verificationFailure)) {
          throw verificationFailure;
        }
      }
    } catch (removeFailure) {
      try {
        renameSync(quarantinePath, path);
      } catch (restoreFailure) {
        preserveCleanupFailure(removeFailure, restoreFailure);
      }
      throw removeFailure;
    }
    return closeFailure;
  } catch (cleanupFailure) {
    return mergeCleanupFailure(closeFailure, cleanupFailure);
  }
}

/**
 * @param {{requestPath: string, lockPath: string, responsePath: string, acknowledgmentPath: string, closedPath: string}} paths
 * @param {{requestIdentity: {dev: number, ino: number} | null, lockIdentity: {dev: number, ino: number} | null, responseIdentity: {dev: number, ino: number} | null, acknowledgmentIdentity: {dev: number, ino: number} | null, closedIdentity: {dev: number, ino: number} | null}} identities
 * @param {unknown} closeFailure
 * @param {(path: string, identity: {dev: number, ino: number}) => void} removeOwnedFile
 */
export function cleanupSubmissionFiles(
  paths,
  identities,
  closeFailure,
  removeOwnedFile,
) {
  /** @type {[string, {dev: number, ino: number} | null][]} */
  const files = [
    [paths.requestPath, identities.requestIdentity],
    [paths.lockPath, identities.lockIdentity],
    [paths.responsePath, identities.responseIdentity],
    [paths.acknowledgmentPath, identities.acknowledgmentIdentity],
    [paths.closedPath, identities.closedIdentity],
  ];
  return files.reduce(
    (failure, [path, identity]) =>
      cleanupOwnedFile(path, identity, failure, removeOwnedFile),
    closeFailure,
  );
}

/**
 * @param {{requestPath: string, lockPath: string, responsePath: string, acknowledgmentPath: string, closedPath: string}} paths
 * @param {{requestIdentity: {dev: number, ino: number} | null, lockIdentity: {dev: number, ino: number} | null, responseIdentity: {dev: number, ino: number} | null, acknowledgmentIdentity: {dev: number, ino: number} | null, closedIdentity: {dev: number, ino: number} | null}} identities
 * @param {unknown} closeFailure
 * @param {(path: string, identity: {dev: number, ino: number}) => void} removeOwnedFile
 * @param {number} [attempts]
 * @returns {Promise<{drained: boolean, failure: unknown}>}
 */
export async function drainSubmissionArtifacts(
  paths,
  identities,
  closeFailure,
  removeOwnedFile,
  attempts = 100,
) {
  let failure = closeFailure;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    failure = cleanupOwnedSubmissionFiles(
      paths,
      identities,
      failure,
      removeOwnedFile,
    );
    if (!hasOwnedSubmissionArtifacts(paths, identities)) {
      return { drained: true, failure };
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return {
    drained: !hasOwnedSubmissionArtifacts(paths, identities),
    failure,
  };
}

/**
 * @param {{requestPath: string, lockPath: string, responsePath: string, acknowledgmentPath: string, closedPath: string}} paths
 * @param {{requestIdentity: {dev: number, ino: number} | null, lockIdentity: {dev: number, ino: number} | null, responseIdentity: {dev: number, ino: number} | null, acknowledgmentIdentity: {dev: number, ino: number} | null, closedIdentity: {dev: number, ino: number} | null}} identities
 * @param {unknown} closeFailure
 * @param {(path: string, identity: {dev: number, ino: number}) => void} removeOwnedFile
 */
function cleanupOwnedSubmissionFiles(
  paths,
  identities,
  closeFailure,
  removeOwnedFile,
) {
  /** @type {[string, {dev: number, ino: number} | null][]} */
  const files = [
    [paths.requestPath, identities.requestIdentity],
    [paths.lockPath, identities.lockIdentity],
    [paths.responsePath, identities.responseIdentity],
    [paths.acknowledgmentPath, identities.acknowledgmentIdentity],
  ];
  return files.reduce(
    (failure, [path, identity]) =>
      cleanupOwnedFile(path, identity, failure, removeOwnedFile),
    closeFailure,
  );
}
