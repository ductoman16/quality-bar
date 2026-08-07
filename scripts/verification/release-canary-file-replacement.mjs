import { linkSync, lstatSync, readlinkSync, symlinkSync } from "node:fs";

import { removeOwnedFile } from "../../src/review-run-submission-file-cleanup.js";
import {
  identity,
  matchesStatsIdentity,
} from "./release-canary-file-identity.mjs";

/** @param {unknown} error */
function isExistingPath(error) {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

/**
 * Restore a quarantined artifact without overwriting a concurrent path.
 *
 * @param {string} path
 * @param {string} quarantinePath
 * @param {import("node:fs").Stats} status
 */
export function restoreQuarantinedFile(path, quarantinePath, status) {
  const current = lstatSync(quarantinePath);
  if (
    !matchesStatsIdentity(identity(status), current) ||
    current.isFile() !== status.isFile() ||
    current.isSymbolicLink() !== status.isSymbolicLink()
  ) {
    throw new TypeError(
      `release canary manifest replacement was preserved at ${quarantinePath}`,
    );
  }
  try {
    if (status.isSymbolicLink()) {
      symlinkSync(readlinkSync(quarantinePath), path);
    } else if (status.isFile()) {
      linkSync(quarantinePath, path);
    } else {
      throw new TypeError(
        `release canary manifest replacement was preserved at ${quarantinePath}`,
      );
    }
  } catch (error) {
    if (isExistingPath(error)) {
      throw new Error(
        `release canary manifest replacement was preserved at ${quarantinePath}`,
        { cause: error },
      );
    }
    throw error;
  }
  if (!removeOwnedFile(quarantinePath, identity(status))) {
    throw new Error(
      `release canary manifest replacement was preserved at ${quarantinePath}`,
    );
  }
}
