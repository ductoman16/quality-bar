import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { removeOwnedFile } from "../../src/review-run-submission-file-cleanup.js";
import {
  identity,
  matchesSnapshot,
  matchesStatsIdentity,
} from "./release-canary-file-identity.mjs";

/** @param {import("node:fs").Stats} status */
function cleanupIdentity(status) {
  return {
    ...identity(status),
    gid: status.gid,
    mode: status.mode,
    uid: status.uid,
  };
}

/** @param {unknown} error @param {string} message */
function normalize(error, message) {
  return error instanceof Error
    ? error
    : new TypeError(message, { cause: error });
}

/** @param {unknown} error */
function isExistingPath(error) {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

function unavailable() {
  return Object.assign(
    new Error("paid Codex canary invocation is already in progress"),
    { code: "paid_codex_canary_lock_unavailable" },
  );
}

/** @param {string} path @param {{birthtimeMs: number, dev: number, ino: number}} expected */
export function fsyncPaidCodexCanaryLeaseParent(path, expected) {
  const parent = dirname(path);
  const status = lstatSync(parent);
  if (
    !status.isDirectory() ||
    status.isSymbolicLink() ||
    !matchesStatsIdentity(expected, status)
  ) {
    throw new TypeError("paid Codex canary lock parent identity changed");
  }
  const descriptor = openSync(
    parent,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const descriptorStatus = fstatSync(descriptor);
    if (
      !descriptorStatus.isDirectory() ||
      !matchesStatsIdentity(expected, descriptorStatus)
    ) {
      throw new TypeError("paid Codex canary lock parent identity changed");
    }
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

/**
 * Publish a complete lease record with a no-replace hard link. A crash while
 * writing the sibling preparation file can never expose a partial canonical
 * lease or provider guard.
 *
 * @param {string} path
 * @param {{birthtimeMs: number, dev: number, ino: number}} parentIdentity
 * @param {{leaseId: string, pid: number, startIdentity: string}} record
 * @param {(path: string, expected: {birthtimeMs: number, dev: number, ino: number}) => void} fsyncParent
 */
export function publishPaidCodexCanaryLeaseRecord(
  path,
  parentIdentity,
  record,
  fsyncParent,
) {
  const preparationPath = join(
    dirname(path),
    `.quality-bar-paid-codex-lease-${randomUUID()}.prepare`,
  );
  let descriptor;
  let preparationIdentity =
    /** @type {ReturnType<typeof cleanupIdentity> | null} */ (null);
  let published =
    /** @type {{identity: ReturnType<typeof cleanupIdentity>, record: typeof record} | null} */ (
      null
    );
  /** @type {Error | null} */
  let operationFailure = null;
  /** @type {Error[]} */
  const cleanupFailures = [];
  try {
    descriptor = openSync(
      preparationPath,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW |
        constants.O_WRONLY,
      0o600,
    );
    writeFileSync(descriptor, `${JSON.stringify(record)}\n`);
    fsyncSync(descriptor);
    const descriptorStatus = fstatSync(descriptor);
    const pathStatus = lstatSync(preparationPath);
    if (
      !descriptorStatus.isFile() ||
      !matchesSnapshot(descriptorStatus, pathStatus)
    ) {
      throw new TypeError("paid Codex canary lock preparation changed");
    }
    preparationIdentity = cleanupIdentity(descriptorStatus);
    try {
      linkSync(preparationPath, path);
    } catch (error) {
      if (isExistingPath(error)) {
        throw unavailable();
      }
      throw error;
    }
    const linkedDescriptorStatus = fstatSync(descriptor);
    const publishedStatus = lstatSync(path);
    if (
      !linkedDescriptorStatus.isFile() ||
      !publishedStatus.isFile() ||
      publishedStatus.isSymbolicLink() ||
      !matchesSnapshot(linkedDescriptorStatus, publishedStatus) ||
      !matchesStatsIdentity(
        identity(descriptorStatus),
        linkedDescriptorStatus,
      ) ||
      descriptorStatus.size !== linkedDescriptorStatus.size ||
      descriptorStatus.mtimeMs !== linkedDescriptorStatus.mtimeMs
    ) {
      throw new TypeError("paid Codex canary lock publication changed");
    }
    published = {
      identity: cleanupIdentity(linkedDescriptorStatus),
      record,
    };
    fsyncParent(path, parentIdentity);
  } catch (error) {
    operationFailure = normalize(
      error,
      "paid Codex canary lock publication failed",
    );
  }
  if (descriptor !== undefined) {
    try {
      closeSync(descriptor);
    } catch (error) {
      cleanupFailures.push(
        normalize(error, "paid Codex canary lock preparation close failed"),
      );
    }
  }
  if (preparationIdentity) {
    try {
      if (!removeOwnedFile(preparationPath, preparationIdentity)) {
        throw new Error("paid Codex canary lock preparation identity changed");
      }
      fsyncParent(path, parentIdentity);
    } catch (error) {
      cleanupFailures.push(
        normalize(error, "paid Codex canary lock preparation cleanup failed"),
      );
    }
  }
  if (operationFailure && published) {
    try {
      if (!removeOwnedFile(path, published.identity)) {
        throw new Error("paid Codex canary lock publication identity changed");
      }
      fsyncParent(path, parentIdentity);
    } catch (error) {
      cleanupFailures.push(
        normalize(error, "paid Codex canary lock rollback failed"),
      );
    }
  }
  if (operationFailure && cleanupFailures.length > 0) {
    throw new AggregateError(
      [operationFailure, ...cleanupFailures],
      "paid Codex canary lock publication and cleanup failed",
    );
  }
  if (operationFailure) {
    throw operationFailure;
  }
  if (cleanupFailures.length > 0) {
    throw new AggregateError(
      cleanupFailures,
      "paid Codex canary lock publication cleanup failed",
    );
  }
  return /** @type {NonNullable<typeof published>} */ (published);
}
