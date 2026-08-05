import { lstatSync } from "node:fs";
import { isAbsolute } from "node:path";

import { ReviewRunExecutionError } from "./review-run-result.js";
import { captureFileIdentity } from "./review-run-submission-files.js";

/** @param {string} path */
export function requireCheckoutPath(path) {
  if (typeof path !== "string" || !isAbsolute(path) || path.includes("\0")) {
    throw new TypeError("Review Run checkout path is invalid");
  }
  const status = lstatSync(path);
  if (!status.isDirectory() || status.isSymbolicLink()) {
    throw new TypeError("Review Run checkout path is invalid");
  }
}

export function submissionChannelUnavailable() {
  return new ReviewRunExecutionError(
    "submission_channel_unavailable",
    "Review Run submission channel is unavailable",
  );
}

/** @param {string} path @param {(error: unknown) => boolean} isMissingPath @param {() => Error} unavailable */
export function requireEndpointAvailable(path, isMissingPath, unavailable) {
  try {
    lstatSync(path);
  } catch (error) {
    if (isMissingPath(error)) {
      return;
    }
    throw error;
  }
  throw unavailable();
}

/** @param {string} path @param {{dev: number, ino: number} | null} identity */
export const captureExistingIdentity = (path, identity) =>
  identity ? captureFileIdentity(path, identity) : null;
