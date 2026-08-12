import { createHmac, createPublicKey, randomUUID, verify } from "node:crypto";
import * as fs from "node:fs";

export const MAX_SUBMISSION_BYTES = 1024 * 1024;
export const SUBMISSION_LEASE_HEARTBEAT_MILLISECONDS = 1_000;
export const CHANNEL_UNAVAILABLE =
  "submission_channel_unavailable: Review Run submission channel is unavailable";
export const INVALID_RESPONSE =
  "submission_channel_unavailable: Review Run submission response is invalid";
export const INVALID_SUBMISSION =
  "review_run_submission_invalid: Review Run submission is not valid JSON";
export const TOO_LARGE =
  "review_run_submission_invalid: Review Run submission is too large";
export const responseFileName = "__QUALITY_BAR_SUBMIT_RESPONSE_FILE__";
export const submissionFileName = "__QUALITY_BAR_SUBMIT_FILE__";
export const trustedProcessFile = "__QUALITY_BAR_SUBMIT_TRUSTED_PROCESS_FILE__";
export const responseDeadlineAt = Number("__QUALITY_BAR_SUBMIT_DEADLINE__");
export const submissionMode = String("__QUALITY_BAR_SUBMIT_MODE__");

/** @param {string} message */
export function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

/** @param {unknown} error */
function isMissingPath(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** @param {unknown} error */
function isExistingPath(error) {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

/** @param {string} path @param {string} quarantinePath @param {fs.Stats} current */
function restoreQuarantinedArtifact(path, quarantinePath, current) {
  if (!current.isSymbolicLink() && !current.isFile()) {
    const preservedPath = `${path}.cleanup-preserved-${randomUUID()}`;
    try {
      fs.renameSync(quarantinePath, preservedPath);
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
      fs.symlinkSync(fs.readlinkSync(quarantinePath), path);
    } else {
      fs.linkSync(quarantinePath, path);
    }
  } catch (error) {
    if (!isExistingPath(error)) {
      throw error;
    }
    const preservedPath = `${path}.cleanup-preserved-${randomUUID()}`;
    try {
      fs.renameSync(quarantinePath, preservedPath);
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
  fs.rmSync(quarantinePath, { force: true });
}

export class InvalidResponseError extends Error {}
export class SubmissionTooLargeError extends Error {}

/** @param {string} status @param {number} fallback */
export function outerProcessId(status, fallback) {
  const match = /^NSpid:\s+([0-9]+)(?:\s+[0-9]+)*\s*$/m.exec(status);
  const candidate = Number(match?.[1]);
  return Number.isSafeInteger(candidate) && candidate > 0
    ? candidate
    : fallback;
}

export function submissionClientPid() {
  try {
    return outerProcessId(
      fs.readFileSync("/proc/self/status", "utf8"),
      process.pid,
    );
  } catch {
    return process.pid;
  }
}

/**
 * @param {number} descriptor
 * @param {number} maxBytes
 */
function readBoundedText(descriptor, maxBytes) {
  const chunks = [];
  let length = 0;
  while (true) {
    const chunk = Buffer.allocUnsafe(64 * 1024);
    const bytesRead = fs.readSync(descriptor, chunk, 0, chunk.length, null);
    if (bytesRead === 0) {
      return Buffer.concat(chunks, length).toString("utf8");
    }
    length += bytesRead;
    if (length > maxBytes) {
      throw new SubmissionTooLargeError();
    }
    chunks.push(chunk.subarray(0, bytesRead));
  }
}

/** @param {string} path @param {fs.Stats} owner @param {number} maxBytes */
export function readTrustedFile(path, owner, maxBytes) {
  const pathStatus = fs.lstatSync(path);
  if (
    !pathStatus.isFile() ||
    pathStatus.isSymbolicLink() ||
    (pathStatus.mode & 0o777) !== 0o600 ||
    pathStatus.uid !== owner.uid ||
    pathStatus.gid !== owner.gid
  ) {
    throw new Error("Review Run submission metadata is invalid");
  }
  const descriptor = fs.openSync(
    path,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
  );
  try {
    const status = fs.fstatSync(descriptor);
    if (
      !status.isFile() ||
      status.dev !== pathStatus.dev ||
      status.ino !== pathStatus.ino ||
      status.birthtimeMs !== pathStatus.birthtimeMs ||
      status.uid !== owner.uid ||
      status.gid !== owner.gid ||
      (status.mode & 0o777) !== 0o600 ||
      status.size > maxBytes
    ) {
      throw new Error("Review Run submission metadata identity changed");
    }
    const content = readBoundedText(descriptor, maxBytes);
    const revalidated = fs.lstatSync(path);
    if (
      revalidated.dev !== status.dev ||
      revalidated.ino !== status.ino ||
      revalidated.birthtimeMs !== status.birthtimeMs ||
      revalidated.size !== status.size ||
      revalidated.uid !== status.uid ||
      revalidated.gid !== status.gid ||
      (revalidated.mode & 0o777) !== 0o600
    ) {
      throw new Error("Review Run submission metadata identity changed");
    }
    return content;
  } finally {
    fs.closeSync(descriptor);
  }
}

/**
 * @param {string} path
 * @param {{dev: number, ino: number, birthtimeMs?: number} | null} expected
 */
export function removeOwnedFile(path, expected) {
  if (!expected) {
    return;
  }
  try {
    const status = fs.lstatSync(path);
    if (
      status.dev !== expected.dev ||
      status.ino !== expected.ino ||
      (expected.birthtimeMs !== undefined &&
        status.birthtimeMs !== expected.birthtimeMs)
    ) {
      return;
    }
  } catch (error) {
    if (isMissingPath(error)) {
      return;
    }
    throw error;
  }
  const quarantinePath = `${path}.cleanup-${randomUUID()}`;
  try {
    fs.renameSync(path, quarantinePath);
  } catch (error) {
    if (isMissingPath(error)) {
      return;
    }
    throw error;
  }
  const current = fs.lstatSync(quarantinePath);
  if (
    current.dev === expected.dev &&
    current.ino === expected.ino &&
    (expected.birthtimeMs === undefined ||
      current.birthtimeMs === expected.birthtimeMs)
  ) {
    fs.rmSync(quarantinePath, { force: true });
    return;
  }
  restoreQuarantinedArtifact(path, quarantinePath, current);
}

/** @param {{candidate: unknown, client_id: string, client_pid: number, client_process_group_id: number, client_start_identity: string, request_id: string}} payload @param {string} token */
export function requestSignature(payload, token) {
  return createHmac("sha256", token)
    .update(JSON.stringify(payload))
    .digest("base64");
}

/** @param {string} path @param {string} clientId @param {number} clientPid @param {string} clientStartIdentity @param {string} requestId */
export function publishAcknowledgment(
  path,
  clientId,
  clientPid,
  clientStartIdentity,
  requestId,
) {
  const temporaryPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
  try {
    fs.writeFileSync(
      temporaryPath,
      `${JSON.stringify({
        client_id: clientId,
        client_pid: clientPid,
        client_start_identity: clientStartIdentity,
        request_id: requestId,
      })}\n`,
      { flag: "wx", mode: 0o600 },
    );
    fs.linkSync(temporaryPath, path);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

/** @param {string | undefined} input */
export function readSubmissionText(input) {
  const pathStatus = input === undefined ? null : fs.lstatSync(input);
  const descriptor =
    input === undefined
      ? 0
      : fs.openSync(
          input,
          fs.constants.O_RDONLY |
            fs.constants.O_NOFOLLOW |
            fs.constants.O_NONBLOCK,
        );
  try {
    const status = fs.fstatSync(descriptor);
    if (
      input !== undefined &&
      (!pathStatus?.isFile() ||
        pathStatus.isSymbolicLink() ||
        !status.isFile() ||
        status.dev !== pathStatus.dev ||
        status.ino !== pathStatus.ino ||
        status.uid !== process.getuid?.() ||
        status.gid !== process.getgid?.() ||
        ![0o600, 0o644].includes(status.mode & 0o777))
    ) {
      throw new Error("Review Run submission file provenance is invalid");
    }
    if (status.size > MAX_SUBMISSION_BYTES) {
      throw new SubmissionTooLargeError();
    }
    const content = readBoundedText(descriptor, MAX_SUBMISSION_BYTES);
    if (input !== undefined) {
      const revalidated = fs.lstatSync(input);
      if (
        revalidated.dev !== status.dev ||
        revalidated.ino !== status.ino ||
        ![0o600, 0o644].includes(revalidated.mode & 0o777)
      ) {
        throw new Error("Review Run submission file provenance is invalid");
      }
    }
    return content;
  } finally {
    fs.closeSync(descriptor);
  }
}

/** @param {string} path */
export function readResponse(path) {
  const pathStatus = fs.lstatSync(path);
  const descriptor = fs.openSync(
    path,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
  );
  try {
    const status = fs.fstatSync(descriptor);
    if (
      !pathStatus.isFile() ||
      pathStatus.isSymbolicLink() ||
      !status.isFile() ||
      status.dev !== pathStatus.dev ||
      status.ino !== pathStatus.ino ||
      status.uid !== process.getuid?.() ||
      status.gid !== process.getgid?.() ||
      (status.mode & 0o777) !== 0o600 ||
      status.size > MAX_SUBMISSION_BYTES
    ) {
      throw new InvalidResponseError();
    }
    let response;
    try {
      response = JSON.parse(readBoundedText(descriptor, MAX_SUBMISSION_BYTES));
    } catch {
      throw new InvalidResponseError();
    }
    if (
      !response ||
      typeof response !== "object" ||
      Array.isArray(response) ||
      typeof response.response_signature !== "string" ||
      !response.payload ||
      typeof response.payload !== "object" ||
      Array.isArray(response.payload)
    ) {
      throw new InvalidResponseError();
    }
    let valid = false;
    try {
      valid = verify(
        null,
        Buffer.from(JSON.stringify(response.payload)),
        createPublicKey("__QUALITY_BAR_SUBMIT_RESPONSE_PUBLIC_KEY__"),
        Buffer.from(response.response_signature, "base64"),
      );
    } catch {
      valid = false;
    }
    if (!valid) {
      throw new InvalidResponseError();
    }
    const revalidated = fs.lstatSync(path);
    if (
      revalidated.dev !== status.dev ||
      revalidated.ino !== status.ino ||
      revalidated.uid !== status.uid ||
      revalidated.gid !== status.gid ||
      revalidated.mode !== status.mode
    ) {
      throw new InvalidResponseError();
    }
    return {
      identity: {
        birthtimeMs: status.birthtimeMs,
        dev: status.dev,
        ino: status.ino,
      },
      payload: response.payload,
    };
  } finally {
    fs.closeSync(descriptor);
  }
}
