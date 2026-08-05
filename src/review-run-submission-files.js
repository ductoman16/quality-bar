import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  closeSync,
  constants,
  fstatSync,
  linkSync,
  lstatSync,
  openSync,
  readSync,
  readlinkSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
} from "node:fs";

import { readBoundedText } from "./review-run-submission-io.js";

export const MAX_SUBMISSION_BYTES = 1024 * 1024;
export const SUBMISSION_LEASE_MILLISECONDS = 5_000;
const MAX_PROCESS_ID = 0x7fffffff;

/**
 * Return an identity that changes whenever the operating-system process at a
 * PID is replaced. Linux exposes this directly; macOS provides the same
 * purpose through its process start timestamp.
 *
 * @param {number} pid
 * @returns {string | null}
 */
export function processStartIdentity(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const closingParenthesis = stat.lastIndexOf(")");
    const fields = stat
      .slice(closingParenthesis + 1)
      .trim()
      .split(/\s+/);
    if (closingParenthesis >= 0 && fields[19]) {
      return `linux:${fields[19]}`;
    }
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      typeof error.code !== "string" ||
      !["EACCES", "ENOENT", "ENOTDIR", "EPERM"].includes(error.code)
    ) {
      throw error;
    }
  }
  try {
    const start = execFileSync(
      "/bin/ps",
      ["-o", "lstart=", "-p", String(pid)],
      {
        encoding: "utf8",
      },
    ).trim();
    return start.length > 0 ? `ps:${start}` : null;
  } catch {
    return null;
  }
}

/** @param {number} pid */
/** @param {number} pid */
export function isProcessAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid > MAX_PROCESS_ID) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      typeof error.code === "string" &&
      ["EINVAL", "ESRCH", "ERR_INVALID_ARG_TYPE"].includes(error.code)
    ) {
      return false;
    }
    if (error instanceof Error && "code" in error && error.code === "EPERM") {
      return true;
    }
    throw error;
  }
}

/**
 * @param {{content: string, mtimeMs: number}} lockSubmission
 * @returns {{client_id: string, client_pid: number, client_process_group_id: number, client_start_identity: string, request_id: string} | null}
 */
export function parseSubmissionLock(lockSubmission) {
  try {
    const lock = JSON.parse(lockSubmission.content);
    return Number.isSafeInteger(lock?.client_pid) &&
      lock.client_pid > 0 &&
      lock.client_pid <= MAX_PROCESS_ID &&
      Number.isSafeInteger(lock?.client_process_group_id) &&
      lock.client_process_group_id > 0 &&
      lock.client_process_group_id <= MAX_PROCESS_ID &&
      typeof lock.client_id === "string" &&
      lock.client_id.length > 0 &&
      typeof lock.client_start_identity === "string" &&
      lock.client_start_identity.length > 0 &&
      typeof lock.request_id === "string" &&
      lock.request_id.length > 0
      ? lock
      : null;
  } catch {
    return null;
  }
}

/**
 * @param {{content: string, mtimeMs: number}} lockSubmission
 */
export function isSubmissionLeaseAlive(lockSubmission) {
  const lock = parseSubmissionLock(lockSubmission);
  if (lock === null || !Number.isFinite(lockSubmission.mtimeMs)) {
    return null;
  }
  if (!isProcessAlive(lock.client_pid)) {
    return false;
  }
  const currentStartIdentity = processStartIdentity(lock.client_pid);
  if (currentStartIdentity === null) {
    return null;
  }
  if (currentStartIdentity !== lock.client_start_identity) {
    return false;
  }
  return Math.abs(Date.now() - lockSubmission.mtimeMs) >
    SUBMISSION_LEASE_MILLISECONDS
    ? null
    : true;
}

/** @param {{mtimeMs: number}} lockSubmission */
export function isSubmissionLeaseExpired(lockSubmission) {
  return (
    !Number.isFinite(lockSubmission.mtimeMs) ||
    Math.abs(Date.now() - lockSubmission.mtimeMs) >
      SUBMISSION_LEASE_MILLISECONDS
  );
}

/** @param {unknown} error */
export function isMissingPath(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/**
 * @param {string} path
 * @param {number} mode
 * @param {import("node:fs").Stats | null} owner
 */
export function requirePrivateFile(path, mode, owner = null) {
  const status = lstatSync(path);
  if (
    !status.isFile() ||
    status.isSymbolicLink() ||
    (status.mode & 0o777) !== mode ||
    (owner !== null && (status.uid !== owner.uid || status.gid !== owner.gid))
  ) {
    throw new TypeError("Review Run private submission file is invalid");
  }
  return status;
}

/** @param {unknown} error */
function isExistingPath(error) {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

/**
 * @param {string} path
 * @param {string} quarantinePath
 * @param {import("node:fs").Stats} current
 */
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

/**
 * @param {string} path
 * @param {{dev: number, ino: number, uid?: number, gid?: number, mode?: number}} expected
 * @param {{beforeRename?: () => void, afterQuarantine?: () => void}} [operations]
 */
export function removeOwnedFile(path, expected, operations = {}) {
  const quarantinePath = `${path}.cleanup-${randomUUID()}`;
  try {
    const status = lstatSync(path);
    if (status.dev !== expected.dev || status.ino !== expected.ino) {
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
  if (current.dev !== expected.dev || current.ino !== expected.ino) {
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

/**
 * @param {string} temporaryPath
 * @param {string} targetPath
 * @param {{uid?: number, gid?: number, mode?: number}} [requirements]
 * @param {{beforeOpen?: () => void, afterLink?: () => void}} [operations]
 * @returns {{dev: number, ino: number}}
 */
export function publishFile(
  temporaryPath,
  targetPath,
  requirements = {},
  operations = {},
) {
  let descriptor;
  try {
    const pathStatus = lstatSync(temporaryPath);
    operations.beforeOpen?.();
    descriptor = openSync(
      temporaryPath,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const status = fstatSync(descriptor);
    if (
      !pathStatus.isFile() ||
      pathStatus.isSymbolicLink() ||
      !status.isFile() ||
      pathStatus.dev !== status.dev ||
      pathStatus.ino !== status.ino ||
      (requirements.uid !== undefined && status.uid !== requirements.uid) ||
      (requirements.gid !== undefined && status.gid !== requirements.gid) ||
      (requirements.mode !== undefined && status.mode !== requirements.mode)
    ) {
      throw new TypeError("Submission publication source is not a file");
    }
    const content = Buffer.alloc(status.size);
    let offset = 0;
    while (offset < content.byteLength) {
      const count = readSync(
        descriptor,
        content,
        offset,
        content.byteLength - offset,
        offset,
      );
      if (count === 0) {
        throw new TypeError("Submission publication source was truncated");
      }
      offset += count;
    }
    const source = lstatSync(temporaryPath);
    if (
      source.dev !== status.dev ||
      source.ino !== status.ino ||
      source.size !== content.byteLength ||
      source.uid !== status.uid ||
      source.gid !== status.gid ||
      source.mode !== status.mode
    ) {
      throw new TypeError("Submission publication source identity changed");
    }
    const identity = { dev: status.dev, ino: status.ino };
    linkSync(temporaryPath, targetPath);
    operations.afterLink?.();
    const published = lstatSync(targetPath);
    if (
      !published.isFile() ||
      published.isSymbolicLink() ||
      published.dev !== identity.dev ||
      published.ino !== identity.ino ||
      (requirements.uid !== undefined && published.uid !== requirements.uid) ||
      (requirements.gid !== undefined && published.gid !== requirements.gid) ||
      (requirements.mode !== undefined && published.mode !== requirements.mode)
    ) {
      throw new TypeError("Submission publication identity changed");
    }
    const finalStatus = fstatSync(descriptor);
    if (
      finalStatus.dev !== status.dev ||
      finalStatus.ino !== status.ino ||
      finalStatus.size !== content.byteLength ||
      finalStatus.uid !== status.uid ||
      finalStatus.gid !== status.gid ||
      finalStatus.mode !== status.mode
    ) {
      throw new TypeError("Submission publication descriptor identity changed");
    }
    const finalContent = Buffer.alloc(finalStatus.size);
    offset = 0;
    while (offset < finalContent.byteLength) {
      const count = readSync(
        descriptor,
        finalContent,
        offset,
        finalContent.byteLength - offset,
        offset,
      );
      if (count === 0) {
        throw new TypeError("Submission publication source was truncated");
      }
      offset += count;
    }
    if (!content.equals(finalContent)) {
      throw new TypeError("Submission publication bytes changed");
    }
    return identity;
  } finally {
    if (descriptor !== undefined) {
      closeSync(descriptor);
    }
    rmSync(temporaryPath, { force: true });
  }
}

/**
 * @param {string} path
 * @param {{dev: number, ino: number} | null} current
 * @returns {{dev: number, ino: number} | null}
 */
export function captureFileIdentity(path, current) {
  if (current) {
    return current;
  }
  try {
    const status = lstatSync(path);
    return status.isFile() ? { dev: status.dev, ino: status.ino } : null;
  } catch (error) {
    if (isMissingPath(error)) {
      return null;
    }
    throw error;
  }
}

/**
 * @param {string} path
 * @param {() => Error} unavailable
 * @param {{uid: number, gid: number}} owner
 * @returns {{content: string, identity: {dev: number, ino: number, uid: number, gid: number, mode: number}, mtimeMs: number}}
 */
export function readSubmissionFile(path, unavailable, owner) {
  let descriptor;
  try {
    const pathStatus = lstatSync(path);
    if (
      !pathStatus.isFile() ||
      pathStatus.isSymbolicLink() ||
      (pathStatus.mode & 0o777) !== 0o600 ||
      pathStatus.uid !== owner.uid ||
      pathStatus.gid !== owner.gid ||
      pathStatus.size > MAX_SUBMISSION_BYTES
    ) {
      throw unavailable();
    }
    descriptor = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const status = fstatSync(descriptor);
    if (
      !status.isFile() ||
      (status.mode & 0o777) !== 0o600 ||
      status.uid !== owner.uid ||
      status.gid !== owner.gid ||
      status.dev !== pathStatus.dev ||
      status.ino !== pathStatus.ino ||
      status.size > MAX_SUBMISSION_BYTES
    ) {
      throw unavailable();
    }
    return {
      content: readBoundedText(descriptor, MAX_SUBMISSION_BYTES),
      identity: {
        dev: status.dev,
        gid: status.gid,
        ino: status.ino,
        mode: status.mode,
        uid: status.uid,
      },
      mtimeMs: status.mtimeMs,
    };
  } finally {
    if (descriptor !== undefined) {
      closeSync(descriptor);
    }
  }
}
