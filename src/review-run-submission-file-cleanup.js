import { randomUUID } from "node:crypto";
import {
  linkSync,
  lstatSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
} from "node:fs";

import { isMissingPath } from "./review-run-submission-files.js";

/** @param {unknown} error */
function isExistingPath(error) {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

/** @param {string} path @param {string} quarantinePath @param {import("node:fs").Stats} current */
function restoreQuarantinedArtifact(path, quarantinePath, current) {
  if (!current.isSymbolicLink() && !current.isFile()) {
    const preservedPath = `${path}.cleanup-preserved-${randomUUID()}`;
    try {
      renameSync(quarantinePath, preservedPath);
    } catch (preserveError) {
      throw new Error(
        "Submission cleanup could not preserve a non-restorable artifact",
        { cause: preserveError },
      );
    }
    throw new TypeError(
      `Submission cleanup encountered a non-restorable artifact; preserved it at ${preservedPath}`,
    );
  }
  try {
    if (current.isSymbolicLink()) {
      symlinkSync(readlinkSync(quarantinePath), path);
    } else {
      linkSync(quarantinePath, path);
    }
  } catch (error) {
    if (!isExistingPath(error)) {
      throw error;
    }
    const preservedPath = `${path}.cleanup-preserved-${randomUUID()}`;
    try {
      renameSync(quarantinePath, preservedPath);
    } catch (preserveError) {
      throw new Error(
        "Submission cleanup could not preserve a concurrent artifact replacement",
        { cause: preserveError },
      );
    }
    throw new Error(
      `Submission cleanup encountered a concurrent artifact replacement; preserved the quarantined artifact at ${preservedPath}`,
      { cause: error },
    );
  }
  rmSync(quarantinePath, { force: true });
}

/** @param {string} path @param {{dev: number, ino: number, birthtimeMs?: number, uid?: number, gid?: number, mode?: number}} expected @param {{beforeRename?: () => void, afterQuarantine?: () => void}} [operations] */
export function removeOwnedFile(path, expected, operations = {}) {
  const quarantinePath = `${path}.cleanup-${randomUUID()}`;
  try {
    const status = lstatSync(path);
    if (
      status.dev !== expected.dev ||
      status.ino !== expected.ino ||
      (expected.birthtimeMs !== undefined &&
        status.birthtimeMs !== expected.birthtimeMs)
    ) {
      return;
    }
    if (
      (expected.uid !== undefined && status.uid !== expected.uid) ||
      (expected.gid !== undefined && status.gid !== expected.gid) ||
      (expected.mode !== undefined && status.mode !== expected.mode)
    ) {
      throw new TypeError("Submission cleanup artifact metadata changed");
    }
  } catch (error) {
    if (isMissingPath(error)) {
      return;
    }
    throw error;
  }
  operations.beforeRename?.();
  try {
    renameSync(path, quarantinePath);
  } catch (error) {
    if (isMissingPath(error)) {
      return;
    }
    throw error;
  }
  const current = lstatSync(quarantinePath);
  operations.afterQuarantine?.();
  if (!current.isFile()) {
    restoreQuarantinedArtifact(path, quarantinePath, current);
    throw new TypeError("Submission cleanup encountered a non-file artifact");
  }
  if (
    current.dev !== expected.dev ||
    current.ino !== expected.ino ||
    (expected.birthtimeMs !== undefined &&
      current.birthtimeMs !== expected.birthtimeMs)
  ) {
    restoreQuarantinedArtifact(path, quarantinePath, current);
    return;
  }
  if (
    (expected.uid !== undefined && current.uid !== expected.uid) ||
    (expected.gid !== undefined && current.gid !== expected.gid) ||
    (expected.mode !== undefined && current.mode !== expected.mode)
  ) {
    restoreQuarantinedArtifact(path, quarantinePath, current);
    throw new TypeError("Submission cleanup artifact metadata changed");
  }
  rmSync(quarantinePath, { force: true });
}
