import { lstatSync } from "node:fs";
import { isAbsolute } from "node:path";

import { ReviewRunExecutionError } from "./review-run-result.ts";
import { captureFileIdentity } from "./review-run-submission-files.ts";

export function captureDirectoryIdentity(path: string) {
  const status = lstatSync(path);
  return {
    birthtimeMs: status.birthtimeMs,
    dev: status.dev,
    gid: status.gid,
    ino: status.ino,
    uid: status.uid,
  };
}

export function requireCheckoutPath(path: string) {
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

export function requireEndpointAvailable(
  path: string,
  isMissingPath: (error: unknown) => boolean,
  unavailable: () => Error,
) {
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

export const captureExistingIdentity = (
  path: string,
  identity: { birthtimeMs: number; dev: number; ino: number } | null,
) => (identity ? captureFileIdentity(path, identity) : null);
