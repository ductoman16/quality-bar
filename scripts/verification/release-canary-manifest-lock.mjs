import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

import { removeOwnedFile } from "../../src/review-run-submission-file-cleanup.js";
import {
  isProcessAlive,
  processStartIdentity,
} from "../../src/review-run-submission-files.js";
import {
  fsyncDirectory,
  isMissingPath,
  matchesIdentity,
  readBoundJson,
  writeDurableJson,
} from "./release-canary-files.mjs";

/** @param {string} [message] @param {unknown} [cause] */
function unavailable(
  message = "release canary manifest update is already in progress",
  cause,
) {
  return Object.assign(
    new Error(message, cause === undefined ? {} : { cause }),
    {
      code: "release_canary_manifest_lock_unavailable",
    },
  );
}

/** @param {unknown} value */
function validRecord(value) {
  return (
    value !== null &&
    !Array.isArray(value) &&
    typeof value === "object" &&
    Object.keys(value).sort().join("\0") ===
      ["leaseId", "pid", "startIdentity"].sort().join("\0") &&
    "leaseId" in value &&
    typeof value.leaseId === "string" &&
    value.leaseId.length > 0 &&
    "pid" in value &&
    Number.isSafeInteger(value.pid) &&
    /** @type {number} */ (value.pid) > 0 &&
    "startIdentity" in value &&
    typeof value.startIdentity === "string" &&
    value.startIdentity.length > 0
  );
}

/** @param {string} path @param {{birthtimeMs: number, dev: number, ino: number}} parentIdentity */
function readLock(path, parentIdentity) {
  let lock;
  try {
    lock = readBoundJson(path, parentIdentity);
  } catch (error) {
    if (isMissingPath(error)) {
      return null;
    }
    throw unavailable("release canary manifest lock is invalid", error);
  }
  if (!validRecord(lock.value)) {
    throw unavailable("release canary manifest lock is invalid");
  }
  return lock;
}

/** @param {NonNullable<ReturnType<typeof readLock>>} lock */
function ownedLock(lock) {
  return {
    identity: {
      ...lock.identity,
      gid: lock.snapshot.gid,
      mode: lock.snapshot.mode,
      uid: lock.snapshot.uid,
    },
    record:
      /** @type {{leaseId: string, pid: number, startIdentity: string}} */ (
        lock.value
      ),
  };
}

/** @param {NonNullable<ReturnType<typeof readLock>>} lock */
function isLive(lock) {
  const { record } = ownedLock(lock);
  const currentStartIdentity = processStartIdentity(record.pid);
  return (
    isProcessAlive(record.pid) &&
    (currentStartIdentity === null ||
      currentStartIdentity === record.startIdentity)
  );
}

/** @param {string} path @param {{birthtimeMs: number, dev: number, ino: number}} parentIdentity @param {NonNullable<ReturnType<typeof readLock>>} lock */
function retire(path, parentIdentity, lock) {
  if (!removeOwnedFile(path, ownedLock(lock).identity)) {
    throw unavailable("release canary stale manifest lock changed");
  }
  fsyncDirectory(dirname(path), parentIdentity);
}

/** @param {string} path @param {{birthtimeMs: number, dev: number, ino: number}} parentIdentity @param {{leaseId: string, pid: number, startIdentity: string}} record */
function publish(path, parentIdentity, record) {
  let publishedIdentity;
  try {
    publishedIdentity = writeDurableJson(path, record, null, parentIdentity);
  } catch (error) {
    const competingLock = readLock(path, parentIdentity);
    if (competingLock !== null) {
      throw unavailable(undefined, error);
    }
    throw error;
  }
  const lock = readLock(path, parentIdentity);
  if (
    lock === null ||
    !matchesIdentity(publishedIdentity, lock.identity) ||
    JSON.stringify(lock.value) !== JSON.stringify(record)
  ) {
    throw unavailable("release canary manifest lock changed");
  }
  return ownedLock(lock);
}

/** @param {string} lockPath @param {{birthtimeMs: number, dev: number, ino: number}} parentIdentity @param {{leaseId: string, pid: number, startIdentity: string}} record */
function recoverGuard(lockPath, parentIdentity, record) {
  const guardPath = `${lockPath}.recovery`;
  const guard = readLock(guardPath, parentIdentity);
  if (guard === null) {
    return null;
  }
  if (isLive(guard)) {
    throw unavailable();
  }
  const canonical = readLock(lockPath, parentIdentity);
  if (canonical === null) {
    const owner = publish(lockPath, parentIdentity, record);
    retire(guardPath, parentIdentity, guard);
    return owner;
  }
  retire(guardPath, parentIdentity, guard);
  return null;
}

/** @param {string} lockPath @param {{birthtimeMs: number, dev: number, ino: number}} parentIdentity */
export function acquireReleaseCanaryManifestLock(lockPath, parentIdentity) {
  const startIdentity = processStartIdentity(process.pid);
  if (startIdentity === null) {
    throw unavailable("release canary manifest lock identity is unavailable");
  }
  const record = { leaseId: randomUUID(), pid: process.pid, startIdentity };
  const recovered = recoverGuard(lockPath, parentIdentity, record);
  if (recovered !== null) {
    return recovered;
  }
  const stale = readLock(lockPath, parentIdentity);
  if (stale === null) {
    return publish(lockPath, parentIdentity, record);
  }
  if (isLive(stale)) {
    throw unavailable();
  }
  const guardPath = `${lockPath}.recovery`;
  const guard = publish(guardPath, parentIdentity, record);
  retire(lockPath, parentIdentity, stale);
  const owner = publish(lockPath, parentIdentity, record);
  const currentGuard = readLock(guardPath, parentIdentity);
  if (
    currentGuard === null ||
    !matchesIdentity(guard.identity, currentGuard.identity) ||
    currentGuard.value.leaseId !== guard.record.leaseId
  ) {
    throw unavailable("release canary manifest recovery guard changed");
  }
  retire(guardPath, parentIdentity, currentGuard);
  return owner;
}

/** @param {string} manifestPath @param {{birthtimeMs: number, dev: number, ino: number}} parentIdentity */
export function requireReleaseCanaryManifestUnlocked(
  manifestPath,
  parentIdentity,
) {
  const lockPath = `${manifestPath}.release-canary.lock`;
  if (
    readLock(lockPath, parentIdentity) !== null ||
    readLock(`${lockPath}.recovery`, parentIdentity) !== null
  ) {
    throw unavailable();
  }
}
