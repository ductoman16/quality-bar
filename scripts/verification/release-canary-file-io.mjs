import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import {
  identity,
  matchesIdentity,
  matchesSnapshot,
  matchesStatsIdentity as matches,
} from "./release-canary-file-identity.mjs";

export { identity, matchesIdentity, matchesSnapshot };

const MAX_RELEASE_CANARY_MANIFEST_BYTES = 1024 * 1024;

/** @param {unknown} error */
export function isMissingPath(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** @param {unknown} error @param {string} message */
export function normalizeFailure(error, message) {
  return error instanceof Error
    ? error
    : new TypeError(message, { cause: error });
}

/** @param {string} path */
export function captureParent(path) {
  const status = lstatSync(dirname(path));
  if (!status.isDirectory() || status.isSymbolicLink()) {
    throw new TypeError("release canary evidence parent is invalid");
  }
  return identity(status);
}

/** @param {string} path @param {{birthtimeMs: number, dev: number, ino: number}} expected */
export function requireParent(path, expected) {
  const status = lstatSync(dirname(path));
  if (
    !status.isDirectory() ||
    status.isSymbolicLink() ||
    !matches(expected, status)
  ) {
    throw new TypeError("release canary evidence parent identity changed");
  }
}

/** @param {string} path @param {{birthtimeMs: number, dev: number, ino: number}} expected */
export function fsyncDirectory(path, expected) {
  requireParent(join(path, "entry"), expected);
  const descriptor = openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const status = fstatSync(descriptor);
    if (!status.isDirectory() || !matches(expected, status)) {
      throw new TypeError("release canary evidence parent identity changed");
    }
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

/** @param {string} path @param {{birthtimeMs: number, dev: number, ino: number} | null} expected */
export function requirePathIdentity(path, expected) {
  if (expected === null) {
    try {
      lstatSync(path);
    } catch (error) {
      if (isMissingPath(error)) {
        return;
      }
      throw error;
    }
    throw new TypeError("release canary manifest identity changed");
  }
  const status = lstatSync(path);
  if (
    !status.isFile() ||
    status.isSymbolicLink() ||
    !matches(expected, status)
  ) {
    throw new TypeError("release canary manifest identity changed");
  }
}

/**
 * @param {string} path
 * @param {{birthtimeMs: number, dev: number, ino: number}} [expectedParent]
 */
export function readBoundJson(path, expectedParent = captureParent(path)) {
  let descriptor;
  try {
    requireParent(path, expectedParent);
    const pathStatus = lstatSync(path);
    if (!pathStatus.isFile() || pathStatus.isSymbolicLink()) {
      throw new TypeError("release canary manifest is not a regular file");
    }
    const expected = identity(pathStatus);
    descriptor = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const descriptorStatus = fstatSync(descriptor);
    if (!matches(expected, descriptorStatus)) {
      throw new TypeError("release canary manifest identity changed");
    }
    if (descriptorStatus.size > MAX_RELEASE_CANARY_MANIFEST_BYTES) {
      throw new TypeError("release canary manifest is too large");
    }
    const source = readFileSync(descriptor, "utf8");
    if (Buffer.byteLength(source) > MAX_RELEASE_CANARY_MANIFEST_BYTES) {
      throw new TypeError("release canary manifest is too large");
    }
    if (!matchesSnapshot(descriptorStatus, fstatSync(descriptor))) {
      throw new TypeError("release canary manifest changed while reading");
    }
    const value = JSON.parse(source);
    requireParent(path, expectedParent);
    const finalPathStatus = lstatSync(path);
    if (
      !finalPathStatus.isFile() ||
      finalPathStatus.isSymbolicLink() ||
      !matchesSnapshot(descriptorStatus, finalPathStatus)
    ) {
      throw new TypeError("release canary manifest changed while reading");
    }
    return {
      identity: expected,
      parentIdentity: expectedParent,
      snapshot: descriptorStatus,
      value,
    };
  } finally {
    if (descriptor !== undefined) {
      closeSync(descriptor);
    }
  }
}
