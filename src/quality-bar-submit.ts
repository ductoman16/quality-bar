import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
const CHANNEL_UNAVAILABLE =
  "submission_channel_unavailable: Review Run submission channel is unavailable";
function fail(message: string) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
function requireTrustedPrivateFile(
  path: string,
  mode: number,
  owner: import("node:fs").Stats | null = null,
) {
  const status = fs.lstatSync(path);
  if (
    !status.isFile() ||
    status.isSymbolicLink() ||
    (status.mode & 0o777) !== mode ||
    (owner !== null && (status.uid !== owner.uid || status.gid !== owner.gid))
  ) {
    throw new Error("Review Run submission runtime metadata is invalid");
  }
  return status;
}

const runtimeUrl = new URL("./quality-bar-submit-runtime.ts", import.meta.url);
let runtime: any = null;
let trustedCommandStatus: import("node:fs").Stats | null = null;
try {
  trustedCommandStatus = requireTrustedPrivateFile(
    fileURLToPath(import.meta.url),
    0o700,
  );
  const runtimePath = fileURLToPath(runtimeUrl);
  const runtimePathStatus = requireTrustedPrivateFile(
    runtimePath,
    0o600,
    trustedCommandStatus,
  );
  const runtimeDescriptor = fs.openSync(
    runtimePath,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
  );
  let runtimeSource;
  try {
    const runtimeStatus = fs.fstatSync(runtimeDescriptor);
    if (
      !runtimeStatus.isFile() ||
      runtimeStatus.dev !== runtimePathStatus.dev ||
      runtimeStatus.ino !== runtimePathStatus.ino ||
      runtimeStatus.uid !== trustedCommandStatus.uid ||
      runtimeStatus.gid !== trustedCommandStatus.gid ||
      (runtimeStatus.mode & 0o777) !== 0o600
    ) {
      throw new Error("Review Run submission runtime identity changed");
    }
    runtimeSource = fs.readFileSync(runtimeDescriptor);
    const revalidated = requireTrustedPrivateFile(
      runtimePath,
      0o600,
      trustedCommandStatus,
    );
    if (
      revalidated.dev !== runtimeStatus.dev ||
      revalidated.ino !== runtimeStatus.ino
    ) {
      throw new Error("Review Run submission runtime identity changed");
    }
  } finally {
    fs.closeSync(runtimeDescriptor);
  }
  if (
    createHash("sha256").update(runtimeSource).digest("hex") !==
    "__QUALITY_BAR_SUBMIT_RUNTIME_SHA256__"
  ) {
    throw new Error("Review Run submission runtime identity changed");
  }
  runtime = await import(
    `data:text/javascript;base64,${runtimeSource.toString("base64")}`
  );
} catch {
  fail(CHANNEL_UNAVAILABLE);
}

async function submitCandidate(
  candidate: unknown,
  requestPath: string,
  token: string,
  clientPid: number,
  clientStartIdentity: string,
  clientProcessGroupId: number,
) {
  const helpers = runtime;
  const responsePath = helpers.responseFileName;
  const acknowledgmentPath = `${responsePath}.ack`;
  const closedPath = `${requestPath}.closed`;
  const lockPath = `${requestPath}.lock`;
  const temporaryRequestPath = `${requestPath}.tmp-${process.pid}-${randomUUID()}`;
  const requestId = randomUUID();
  const clientId = randomUUID();
  let lockIdentity: { birthtimeMs: number; dev: number; ino: number } | null =
    null;
  let requestIdentity: {
    birthtimeMs: number;
    dev: number;
    ino: number;
  } | null = null;
  let leaseTimer = null;
  let leaseFailure = null;
  try {
    const lockDescriptor = fs.openSync(lockPath, "wx", 0o600);
    let ownedLockIdentity;
    try {
      fs.writeFileSync(
        lockDescriptor,
        `${JSON.stringify({
          client_id: clientId,
          client_pid: clientPid,
          client_process_group_id: clientProcessGroupId,
          client_start_identity: clientStartIdentity,
          request_id: requestId,
        })}\n`,
      );
      const lock = fs.fstatSync(lockDescriptor);
      ownedLockIdentity = {
        birthtimeMs: lock.birthtimeMs,
        dev: lock.dev,
        ino: lock.ino,
      };
    } finally {
      fs.closeSync(lockDescriptor);
    }
    lockIdentity = ownedLockIdentity;
    if (fs.existsSync(closedPath)) {
      helpers.fail(CHANNEL_UNAVAILABLE);
      return;
    }
    leaseTimer = setInterval(() => {
      try {
        const descriptor = fs.openSync(
          lockPath,
          fs.constants.O_WRONLY |
            fs.constants.O_NOFOLLOW |
            fs.constants.O_NONBLOCK,
        );
        try {
          const status = fs.fstatSync(descriptor);
          if (
            !status.isFile() ||
            status.dev !== ownedLockIdentity.dev ||
            status.ino !== ownedLockIdentity.ino ||
            status.birthtimeMs !== ownedLockIdentity.birthtimeMs
          ) {
            throw new Error("Review Run submission lock identity changed");
          }
          const now = new Date();
          fs.futimesSync(descriptor, now, now);
        } finally {
          fs.closeSync(descriptor);
        }
      } catch (error) {
        leaseFailure =
          error instanceof Error
            ? error
            : new Error("Review Run submission lock lease failed");
      }
    }, helpers.SUBMISSION_LEASE_HEARTBEAT_MILLISECONDS);
    leaseTimer.unref?.();
    const requestPayload = {
      candidate,
      client_id: clientId,
      client_pid: clientPid,
      client_process_group_id: clientProcessGroupId,
      client_start_identity: clientStartIdentity,
      request_id: requestId,
    };
    try {
      const requestDescriptor = fs.openSync(temporaryRequestPath, "wx", 0o600);
      try {
        fs.writeFileSync(
          requestDescriptor,
          `${JSON.stringify({
            ...requestPayload,
            request_signature: helpers.requestSignature(requestPayload, token),
          })}\n`,
        );
        const request = fs.fstatSync(requestDescriptor);
        requestIdentity = {
          birthtimeMs: request.birthtimeMs,
          dev: request.dev,
          ino: request.ino,
        };
      } finally {
        fs.closeSync(requestDescriptor);
      }
      fs.linkSync(temporaryRequestPath, requestPath);
    } finally {
      fs.rmSync(temporaryRequestPath, { force: true });
    }
    if (fs.existsSync(closedPath)) {
      helpers.fail(CHANNEL_UNAVAILABLE);
      return;
    }
    while (true) {
      if (leaseFailure) {
        throw leaseFailure;
      }
      if (Date.now() >= helpers.responseDeadlineAt) {
        helpers.fail(CHANNEL_UNAVAILABLE);
        return;
      }
      let response;
      try {
        response = helpers.readResponse(responsePath);
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          if (fs.existsSync(closedPath)) {
            helpers.fail(CHANNEL_UNAVAILABLE);
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
          continue;
        }
        if (error instanceof helpers.InvalidResponseError) {
          helpers.fail(helpers.INVALID_RESPONSE);
          return;
        }
        throw error;
      }
      if (response.payload?.request_id !== requestId) {
        helpers.fail(helpers.INVALID_RESPONSE);
        return;
      }
      if (response.payload.ok === true) {
        helpers.publishAcknowledgment(
          acknowledgmentPath,
          clientId,
          clientPid,
          clientStartIdentity,
          requestId,
        );
        helpers.removeOwnedFile(responsePath, response.identity);
        return;
      }
      if (
        response.payload.error &&
        typeof response.payload.error.code === "string" &&
        typeof response.payload.error.message === "string"
      ) {
        helpers.publishAcknowledgment(
          acknowledgmentPath,
          clientId,
          clientPid,
          clientStartIdentity,
          requestId,
        );
        helpers.removeOwnedFile(responsePath, response.identity);
        helpers.fail(
          `${response.payload.error.code}: ${response.payload.error.message}`,
        );
      } else {
        helpers.fail(helpers.INVALID_RESPONSE);
      }
      return;
    }
  } catch {
    helpers.fail(CHANNEL_UNAVAILABLE);
  } finally {
    clearInterval(leaseTimer ?? undefined);
    try {
      helpers.removeOwnedFile(requestPath, requestIdentity);
      helpers.removeOwnedFile(lockPath, lockIdentity);
    } catch {
      helpers.fail(CHANNEL_UNAVAILABLE);
    }
    fs.rmSync(temporaryRequestPath, { force: true });
  }
}

if (runtime !== null) {
  const helpers = runtime;
  const submissionFileName = helpers.submissionFileName;
  let token;
  let trustedProcess = null;
  try {
    if (trustedCommandStatus === null) {
      throw new Error("Review Run submission command identity is unavailable");
    }
    token = helpers.readTrustedFile(
      fileURLToPath(new URL("./quality-bar-submit-token", import.meta.url)),
      trustedCommandStatus,
      128,
    );
    if (token.length === 0) {
      throw new Error("Review Run submission token is empty");
    }
    const parsed = JSON.parse(
      helpers.readTrustedFile(
        helpers.trustedProcessFile,
        trustedCommandStatus,
        1024,
      ),
    );
    if (
      !parsed ||
      Array.isArray(parsed) ||
      !Number.isSafeInteger(parsed.client_pid) ||
      parsed.client_pid < 1 ||
      !Number.isSafeInteger(parsed.client_process_group_id) ||
      parsed.client_process_group_id < 1 ||
      typeof parsed.client_start_identity !== "string" ||
      parsed.client_start_identity.length === 0
    ) {
      throw new Error("Review Run trusted process metadata is invalid");
    }
    trustedProcess = parsed;
  } catch {
    token = undefined;
    trustedProcess = null;
  }
  const clientPid = helpers.submissionClientPid();
  const clientStartIdentity = trustedProcess?.client_start_identity;
  const clientProcessGroupId = trustedProcess?.client_process_group_id;
  if (
    typeof submissionFileName !== "string" ||
    submissionFileName.length === 0 ||
    /[\\/\0]/.test(submissionFileName) ||
    submissionFileName === "." ||
    submissionFileName === ".." ||
    trustedProcess === null ||
    typeof token !== "string" ||
    token.length === 0 ||
    typeof clientStartIdentity !== "string" ||
    !Number.isSafeInteger(clientProcessGroupId) ||
    clientProcessGroupId < 1 ||
    !(
      (helpers.submissionMode === "review-file" &&
        process.argv.length === 3 &&
        process.argv[2] === ".quality-bar-result.json") ||
      (helpers.submissionMode === "generic" && process.argv.length < 4)
    )
  ) {
    helpers.fail(CHANNEL_UNAVAILABLE);
  } else {
    let submissionText: string | undefined;
    try {
      submissionText = helpers.readSubmissionText(process.argv[2]);
    } catch (error) {
      helpers.fail(
        error instanceof helpers.SubmissionTooLargeError
          ? helpers.TOO_LARGE
          : helpers.INVALID_SUBMISSION,
      );
    }
    if (submissionText !== undefined) {
      let candidate: unknown;
      try {
        candidate = JSON.parse(submissionText);
      } catch {
        helpers.fail(helpers.INVALID_SUBMISSION);
      }
      if (candidate !== undefined) {
        await submitCandidate(
          candidate,
          submissionFileName,
          token,
          clientPid,
          clientStartIdentity,
          clientProcessGroupId,
        );
      }
    }
  }
}
