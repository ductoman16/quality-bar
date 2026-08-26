import { execFileSync } from "node:child_process";
import {
  closeSync,
  constants,
  fstatSync,
  linkSync,
  lstatSync,
  openSync,
  readSync,
  readFileSync,
  rmSync,
} from "node:fs";

import { readBoundedText } from "./review-run-submission-io.ts";

export const MAX_SUBMISSION_BYTES = 1024 * 1024;
export const SUBMISSION_LEASE_MILLISECONDS = 5_000;
const MAX_PROCESS_ID = 0x7fffffff;

/**
 * Return an identity that changes whenever the operating-system process at a
 * PID is replaced. Linux exposes this directly; macOS provides the same
 * purpose through its process start timestamp.
 */
export function processStartIdentity(pid: number): string | null {
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

export function isProcessAlive(pid: number) {
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

export function parseSubmissionLock(lockSubmission: {
  content: string;
  mtimeMs: number;
}): {
  client_id: string;
  client_pid: number;
  client_process_group_id: number;
  client_start_identity: string;
  request_id: string;
} | null {
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

export function isSubmissionLeaseAlive(lockSubmission: {
  content: string;
  mtimeMs: number;
}) {
  const lock = parseSubmissionLock(lockSubmission);
  if (lock === null || !Number.isFinite(lockSubmission.mtimeMs)) {
    return null;
  }
  if (!isProcessAlive(lock.client_pid)) {
    return false;
  }
  if (!isProcessAlive(lock.client_process_group_id)) {
    return false;
  }
  const currentStartIdentity = processStartIdentity(
    lock.client_process_group_id,
  );
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

export function isSubmissionLeaseExpired(lockSubmission: { mtimeMs: number }) {
  return (
    !Number.isFinite(lockSubmission.mtimeMs) ||
    Math.abs(Date.now() - lockSubmission.mtimeMs) >
      SUBMISSION_LEASE_MILLISECONDS
  );
}

export function isMissingPath(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export function requirePrivateFile(
  path: string,
  mode: number,
  owner: import("node:fs").Stats | null = null,
) {
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

export function publishFile(
  temporaryPath: string,
  targetPath: string,
  requirements: { uid?: number; gid?: number; mode?: number } = {},
  operations: { beforeOpen?: () => void; afterLink?: () => void } = {},
): { birthtimeMs: number; dev: number; ino: number } {
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
    const identity = {
      birthtimeMs: status.birthtimeMs,
      dev: status.dev,
      ino: status.ino,
    };
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

export function captureFileIdentity(
  path: string,
  current: { birthtimeMs: number; dev: number; ino: number } | null,
): { birthtimeMs: number; dev: number; ino: number } | null {
  if (current) {
    return current;
  }
  try {
    const status = lstatSync(path);
    return status.isFile()
      ? { birthtimeMs: status.birthtimeMs, dev: status.dev, ino: status.ino }
      : null;
  } catch (error) {
    if (isMissingPath(error)) {
      return null;
    }
    throw error;
  }
}

export function readSubmissionFile(
  path: string,
  unavailable: () => Error,
  owner: { uid: number; gid: number },
): {
  content: string;
  identity: {
    birthtimeMs: number;
    dev: number;
    ino: number;
    uid: number;
    gid: number;
    mode: number;
  };
  mtimeMs: number;
} {
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
        birthtimeMs: status.birthtimeMs,
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
