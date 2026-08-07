import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

import { removeOwnedFile } from "../../src/review-run-submission-file-cleanup.js";
import {
  isProcessAlive,
  processStartIdentity,
} from "../../src/review-run-submission-files.js";
import {
  fsyncPaidCodexCanaryLeaseParent as fsyncParent,
  publishPaidCodexCanaryLeaseRecord,
} from "./paid-codex-canary-lease-publication.mjs";

const MAX_LEASE_BYTES = 1024;

/** @param {import("node:fs").Stats} status */
function identity(status) {
  return {
    birthtimeMs: status.birthtimeMs,
    dev: status.dev,
    gid: status.gid,
    ino: status.ino,
    mode: status.mode,
    uid: status.uid,
  };
}

/** @param {{birthtimeMs: number, dev: number, ino: number}} expected @param {import("node:fs").Stats} actual */
function matches(expected, actual) {
  return (
    expected.birthtimeMs === actual.birthtimeMs &&
    expected.dev === actual.dev &&
    expected.ino === actual.ino
  );
}

/** @param {import("node:fs").Stats} expected @param {import("node:fs").Stats} actual */
function matchesSnapshot(expected, actual) {
  return (
    matches(identity(expected), actual) &&
    expected.ctimeMs === actual.ctimeMs &&
    expected.mtimeMs === actual.mtimeMs &&
    expected.size === actual.size
  );
}

/** @param {unknown} error @param {string} message */
function normalize(error, message) {
  return error instanceof Error
    ? error
    : new TypeError(message, { cause: error });
}

/** @param {Error[]} errors @param {string} message */
function aggregate(errors, message) {
  const failure = new AggregateError(errors, message);
  const owning = errors.find(
    (error) => "code" in error && typeof error.code === "string",
  );
  if (owning && "code" in owning) {
    Object.assign(failure, { code: owning.code });
  }
  return failure;
}

/** @param {string} message */
function unavailable(
  message = "paid Codex canary invocation is already in progress",
) {
  return Object.assign(new Error(message), {
    code: "paid_codex_canary_lock_unavailable",
  });
}

/**
 * @param {string} path
 * @param {{birthtimeMs: number, dev: number, ino: number}} parentIdentity
 */
function readLease(path, parentIdentity) {
  let descriptor;
  try {
    fsyncParent(path, parentIdentity);
    const pathStatus = lstatSync(path);
    if (
      !pathStatus.isFile() ||
      pathStatus.isSymbolicLink() ||
      pathStatus.size > MAX_LEASE_BYTES
    ) {
      throw unavailable("paid Codex canary lock provenance is invalid");
    }
    descriptor = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const descriptorStatus = fstatSync(descriptor);
    if (
      !descriptorStatus.isFile() ||
      !matchesSnapshot(pathStatus, descriptorStatus)
    ) {
      throw unavailable("paid Codex canary lock provenance changed");
    }
    const source = readFileSync(descriptor, "utf8");
    if (Buffer.byteLength(source) > MAX_LEASE_BYTES) {
      throw unavailable("paid Codex canary lock provenance is invalid");
    }
    const finalDescriptorStatus = fstatSync(descriptor);
    const finalPathStatus = lstatSync(path);
    if (
      !matchesSnapshot(descriptorStatus, finalDescriptorStatus) ||
      !matchesSnapshot(descriptorStatus, finalPathStatus)
    ) {
      throw unavailable("paid Codex canary lock provenance changed");
    }
    let record;
    try {
      record = JSON.parse(source);
    } catch {
      throw unavailable("paid Codex canary lock provenance is invalid");
    }
    if (
      !record ||
      Array.isArray(record) ||
      Object.keys(record).sort().join("\0") !==
        ["leaseId", "pid", "startIdentity"].sort().join("\0") ||
      typeof record.leaseId !== "string" ||
      record.leaseId.length === 0 ||
      !Number.isSafeInteger(record.pid) ||
      record.pid < 1 ||
      typeof record.startIdentity !== "string" ||
      record.startIdentity.length === 0
    ) {
      throw unavailable("paid Codex canary lock provenance is invalid");
    }
    return { identity: identity(descriptorStatus), record };
  } finally {
    if (descriptor !== undefined) {
      closeSync(descriptor);
    }
  }
}

/**
 * @param {string} lockPath
 * @param {{birthtimeMs: number, dev: number, ino: number}} parentIdentity
 * @param {{guard: ({identity: ReturnType<typeof identity>, path: string, record: {leaseId: string, pid: number, startIdentity: string}} | null), identity: ReturnType<typeof identity>, record: {leaseId: string, pid: number, startIdentity: string}} | null} owner
 */
function reconcileLeaseArtifacts(lockPath, parentIdentity, owner) {
  const parent = dirname(lockPath);
  const name = basename(lockPath);
  fsyncParent(lockPath, parentIdentity);
  const candidates = readdirSync(parent)
    .filter(
      (candidate) => candidate === name || candidate.startsWith(`${name}.`),
    )
    .sort();
  for (const candidate of candidates) {
    const path = join(parent, candidate);
    let lease;
    try {
      lease = readLease(path, parentIdentity);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        continue;
      }
      throw error;
    }
    const ownedCanonical =
      owner &&
      path === lockPath &&
      lease.record.leaseId === owner.record.leaseId &&
      matches(owner.identity, /** @type {any} */ (lease.identity));
    const ownedGuard =
      owner?.guard &&
      path === owner.guard.path &&
      lease.record.leaseId === owner.guard.record.leaseId &&
      lease.record.pid === owner.guard.record.pid &&
      lease.record.startIdentity === owner.guard.record.startIdentity &&
      matches(owner.guard.identity, /** @type {any} */ (lease.identity));
    if (ownedCanonical || ownedGuard) {
      continue;
    }
    const currentStartIdentity = processStartIdentity(lease.record.pid);
    if (
      isProcessAlive(lease.record.pid) &&
      (currentStartIdentity === null ||
        currentStartIdentity === lease.record.startIdentity)
    ) {
      throw unavailable();
    }
    if (!removeOwnedFile(path, lease.identity)) {
      throw unavailable("paid Codex canary stale lock ownership changed");
    }
    fsyncParent(lockPath, parentIdentity);
  }
  fsyncParent(lockPath, parentIdentity);
}

/**
 * @param {string} lockPath
 * @param {{birthtimeMs: number, dev: number, ino: number}} parentIdentity
 * @param {{guard: ({identity: ReturnType<typeof identity>, path: string, record: {leaseId: string, pid: number, startIdentity: string}} | null), identity: ReturnType<typeof identity>, record: {leaseId: string, pid: number, startIdentity: string}}} owner
 */
function requireOwnedLock(lockPath, parentIdentity, owner) {
  let current;
  try {
    current = readLease(lockPath, parentIdentity);
  } catch (error) {
    throw Object.assign(
      new Error("paid Codex canary lock identity changed", { cause: error }),
      { code: "paid_codex_canary_lock_lost" },
    );
  }
  if (
    current.record.leaseId !== owner.record.leaseId ||
    current.record.pid !== owner.record.pid ||
    current.record.startIdentity !== owner.record.startIdentity ||
    !matches(owner.identity, /** @type {any} */ (current.identity))
  ) {
    throw Object.assign(new Error("paid Codex canary lock identity changed"), {
      code: "paid_codex_canary_lock_lost",
    });
  }
  if (owner.guard) {
    let currentGuard;
    try {
      currentGuard = readLease(owner.guard.path, parentIdentity);
    } catch (error) {
      throw Object.assign(
        new Error("paid Codex canary provider guard identity changed", {
          cause: error,
        }),
        { code: "paid_codex_canary_lock_lost" },
      );
    }
    if (
      currentGuard.record.leaseId !== owner.guard.record.leaseId ||
      currentGuard.record.pid !== owner.guard.record.pid ||
      currentGuard.record.startIdentity !== owner.guard.record.startIdentity ||
      !matches(owner.guard.identity, /** @type {any} */ (currentGuard.identity))
    ) {
      throw Object.assign(
        new Error("paid Codex canary provider guard identity changed"),
        { code: "paid_codex_canary_lock_lost" },
      );
    }
  }
  reconcileLeaseArtifacts(lockPath, parentIdentity, owner);
}

/**
 * @template T
 * @param {string} lockPath
 * @param {(assertOwned: () => void, trackProcessGroup: (processGroupId: number) => void) => Promise<T>} operation
 * @returns {Promise<T>}
 */
export async function withPaidCodexCanaryLease(lockPath, operation) {
  const parentStatus = lstatSync(dirname(lockPath));
  if (!parentStatus.isDirectory() || parentStatus.isSymbolicLink()) {
    throw new TypeError("paid Codex canary lock parent is invalid");
  }
  const parentIdentity = identity(parentStatus);
  const startIdentity = processStartIdentity(process.pid);
  if (startIdentity === null) {
    throw Object.assign(
      new Error("paid Codex canary process start identity is unavailable"),
      { code: "paid_codex_canary_lock_identity_unavailable" },
    );
  }
  /** @type {{leaseId: string, pid: number, startIdentity: string}} */
  const record = {
    leaseId: randomUUID(),
    pid: process.pid,
    startIdentity,
  };
  let owner =
    /** @type {{guard: ({identity: ReturnType<typeof identity>, path: string, record: typeof record} | null), identity: ReturnType<typeof identity>, record: typeof record} | null} */ (
      null
    );
  /** @type {Error | null} */
  let operationFailure = null;
  /** @type {Error[]} */
  const cleanupFailures = [];
  /** @type {T | undefined} */
  let result;
  try {
    reconcileLeaseArtifacts(lockPath, parentIdentity, null);
    owner = {
      ...publishPaidCodexCanaryLeaseRecord(
        lockPath,
        parentIdentity,
        record,
        fsyncParent,
      ),
      guard: null,
    };
    const activeOwner = owner;
    requireOwnedLock(lockPath, parentIdentity, activeOwner);
    const assertOwned = () =>
      requireOwnedLock(lockPath, parentIdentity, activeOwner);
    const trackProcessGroup = (/** @type {number} */ processGroupId) => {
      if (
        !Number.isSafeInteger(processGroupId) ||
        processGroupId < 1 ||
        activeOwner.guard
      ) {
        throw Object.assign(
          new Error("paid Codex canary provider identity is invalid"),
          { code: "paid_codex_canary_lock_identity_unavailable" },
        );
      }
      requireOwnedLock(lockPath, parentIdentity, activeOwner);
      const providerStartIdentity = processStartIdentity(processGroupId);
      if (providerStartIdentity === null) {
        throw Object.assign(
          new Error("paid Codex canary provider identity is unavailable"),
          { code: "paid_codex_canary_lock_identity_unavailable" },
        );
      }
      const guardRecord = {
        leaseId: activeOwner.record.leaseId,
        pid: processGroupId,
        startIdentity: providerStartIdentity,
      };
      const guardPath = `${lockPath}.guard-${activeOwner.record.leaseId}`;
      activeOwner.guard = {
        ...publishPaidCodexCanaryLeaseRecord(
          guardPath,
          parentIdentity,
          guardRecord,
          fsyncParent,
        ),
        path: guardPath,
      };
      requireOwnedLock(lockPath, parentIdentity, activeOwner);
    };
    result = await operation(assertOwned, trackProcessGroup);
  } catch (error) {
    operationFailure = normalize(error, "paid Codex canary operation failed");
  }
  if (owner?.guard) {
    try {
      if (!removeOwnedFile(owner.guard.path, owner.guard.identity)) {
        throw Object.assign(
          new Error("paid Codex canary provider guard identity changed"),
          { code: "paid_codex_canary_lock_lost" },
        );
      }
      fsyncParent(lockPath, parentIdentity);
    } catch (error) {
      cleanupFailures.push(
        normalize(error, "paid Codex canary provider guard cleanup failed"),
      );
    }
  }
  if (owner) {
    try {
      if (!removeOwnedFile(lockPath, owner.identity)) {
        throw Object.assign(
          new Error("paid Codex canary lock identity changed"),
          { code: "paid_codex_canary_lock_lost" },
        );
      }
      fsyncParent(lockPath, parentIdentity);
    } catch (error) {
      cleanupFailures.push(
        normalize(error, "paid Codex canary lock cleanup failed"),
      );
    }
  }
  if (operationFailure && cleanupFailures.length > 0) {
    throw aggregate(
      [operationFailure, ...cleanupFailures],
      "paid Codex canary operation and lock cleanup failed",
    );
  }
  if (operationFailure) {
    throw operationFailure;
  }
  if (cleanupFailures.length > 0) {
    throw aggregate(cleanupFailures, "paid Codex canary lock cleanup failed");
  }
  return /** @type {T} */ (result);
}
