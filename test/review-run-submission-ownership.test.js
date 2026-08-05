import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { openReviewRunSubmissionChannel } from "../src/review-run-submission-channel.js";
import { createSubmissionProcessor } from "../src/review-run-submission-processor.js";
import { processPendingResponse } from "../src/review-run-submission-pending.js";
import { ReviewRunExecutionError } from "../src/review-run-result.js";
import {
  removeOwnedFile,
  requirePrivateFile,
} from "../src/review-run-submission-files.js";
import { settleSubmissionTerminal } from "../src/review-run-codex-submission-terminal.js";

test("restores a symlink replacement before reporting non-file cleanup", (context) => {
  const checkoutPath = mkdtempSync(join(tmpdir(), "qbs-ownership-"));
  context.after(() => rmSync(checkoutPath, { force: true, recursive: true }));
  const path = join(checkoutPath, "artifact");
  writeFileSync(path, "owned\n");
  const owned = lstatSync(path);
  rmSync(path, { force: true });
  symlinkSync("foreign-target", path);
  removeOwnedFile(path, { dev: owned.dev, ino: owned.ino });
  assert.equal(lstatSync(path).isSymbolicLink(), true);
  assert.equal(readlinkSync(path), "foreign-target");
});

test("preserves both artifacts when restoration races a replacement", (context) => {
  const checkoutPath = mkdtempSync(join(tmpdir(), "qbs-ownership-race-"));
  context.after(() => rmSync(checkoutPath, { force: true, recursive: true }));
  const path = join(checkoutPath, "artifact");
  writeFileSync(path, "owned\n");
  const owned = lstatSync(path);
  /** @type {string | null} */
  let preservedPath = null;
  assert.throws(
    () =>
      removeOwnedFile(
        path,
        { dev: owned.dev, ino: owned.ino },
        {
          beforeRename: () => {
            rmSync(path, { force: true });
            symlinkSync("foreign-target", path);
          },
          afterQuarantine: () => writeFileSync(path, "replacement\n"),
        },
      ),
    (error) => {
      const message = error instanceof Error ? error.message : "";
      assert.match(message, /preserved the quarantined artifact at /);
      preservedPath = message.replace(
        /^.*preserved the quarantined artifact at /,
        "",
      );
      return true;
    },
  );
  assert.equal(typeof preservedPath, "string");
  assert.ok(preservedPath);
  assert.equal(readlinkSync(preservedPath), "foreign-target");
  assert.equal(lstatSync(path).isFile(), true);
  rmSync(preservedPath, { force: true });
});

test("rejects a private submission file owned by a different identity", (context) => {
  const checkoutPath = mkdtempSync(join(tmpdir(), "qbs-ownership-owner-"));
  context.after(() => rmSync(checkoutPath, { force: true, recursive: true }));
  const path = join(checkoutPath, "runtime");
  writeFileSync(path, "runtime\n", { mode: 0o600 });
  const status = lstatSync(path);
  assert.throws(
    () =>
      requirePrivateFile(path, 0o600, {
        ...status,
        uid: status.uid + 1,
      }),
    /Review Run private submission file is invalid/,
  );
});

test("does not remove an empty foreign command directory during close", async (context) => {
  const checkoutPath = mkdtempSync(join(tmpdir(), "qbs-ownership-directory-"));
  context.after(() => rmSync(checkoutPath, { force: true, recursive: true }));
  const channel = await openReviewRunSubmissionChannel(
    { fencingToken: 7, workerId: "worker-1", workId: "run-1" },
    { prepare() {} },
    { checkoutPath },
  );
  const commandDirectory = channel.commandDirectory;
  rmSync(commandDirectory, { force: true, recursive: true });
  mkdirSync(commandDirectory, 0o700);
  await assert.rejects(
    () => channel.close(),
    /command directory ownership changed/,
  );
  assert.equal(lstatSync(commandDirectory).isDirectory(), true);
  rmSync(commandDirectory, { force: true, recursive: true });
});

test("does not remove an empty foreign command directory during setup cleanup", async (context) => {
  const checkoutPath = mkdtempSync(join(tmpdir(), "qbs-ownership-setup-"));
  context.after(() => rmSync(checkoutPath, { force: true, recursive: true }));
  let commandDirectory = "";
  const setupFailure = new Error("command setup failed");
  await assert.rejects(
    () =>
      openReviewRunSubmissionChannel(
        { fencingToken: 7, workerId: "worker-1", workId: "run-1" },
        { prepare() {} },
        {
          checkoutPath,
          writeCommand(commandPath) {
            commandDirectory = dirname(String(commandPath));
            rmSync(commandDirectory, { force: true, recursive: true });
            mkdirSync(commandDirectory, 0o700);
            throw setupFailure;
          },
        },
      ),
    (error) => {
      const typedError = /** @type {any} */ (error);
      assert.equal(error, setupFailure);
      assert.match(
        typedError.submissionCleanupFailure?.message ?? "",
        /command directory ownership changed/,
      );
      return true;
    },
  );
  assert.equal(lstatSync(commandDirectory).isDirectory(), true);
  rmSync(commandDirectory, { force: true, recursive: true });
});

test("shares the acknowledgment inode before stopping acceptance", () => {
  const acknowledgmentIdentity = { dev: 11, ino: 22 };
  /** @type {{dev: number, ino: number} | null} */
  let sharedIdentity = null;
  /** @type {{dev: number, ino: number} | null} */
  let stoppedIdentity = null;
  const pendingResponse = {
    accepted: true,
    client_id: "client",
    client_pid: 123,
    client_start_identity: "linux:start",
    request_id: "request",
    validationFailure: null,
  };
  const result = processPendingResponse({
    acknowledgmentPath: "/ack",
    acknowledgmentIdentity: null,
    failUnexpectedly: (error) => {
      throw error;
    },
    isMissingPath: () => false,
    isPendingClientAlive: () => true,
    isSubmissionLeaseAlive: () => true,
    isSubmissionLeaseExpired: () => false,
    lockPath: "/lock",
    parseSubmissionLock: () => null,
    pendingResponse,
    readSubmissionFile: (path) => {
      assert.equal(path, "/ack");
      return {
        content: JSON.stringify(pendingResponse),
        identity: acknowledgmentIdentity,
      };
    },
    removeOwnedFile: (path, identity) => {
      if (path === "/ack") {
        assert.deepEqual(identity, acknowledgmentIdentity);
      }
    },
    requestChannelUnavailable: () => new Error("unavailable"),
    resolveResult: (value) => assert.equal(value, "accepted"),
    responseIdentity: { dev: 33, ino: 44 },
    responsePath: "/response",
    setAcknowledgmentIdentity: (identity) => {
      sharedIdentity = identity;
    },
    setLastValidationFailure: () => {},
    settlePendingResponse: () => {},
    stopAccepting: () => {
      stoppedIdentity = sharedIdentity;
    },
  });
  assert.deepEqual(stoppedIdentity, acknowledgmentIdentity);
  assert.deepEqual(result.acknowledgmentIdentity, acknowledgmentIdentity);
});

test("does not publish a foreign acknowledgment identity", () => {
  const foreignIdentity = { dev: 55, ino: 66 };
  const pendingResponse = {
    accepted: true,
    client_id: "client",
    client_pid: 123,
    client_start_identity: "linux:start",
    request_id: "request",
    validationFailure: null,
  };
  /** @type {{dev: number, ino: number} | null} */
  let sharedIdentity = null;
  let stopped = false;
  /** @type {any} */
  let failure = null;
  processPendingResponse({
    acknowledgmentPath: "/ack",
    acknowledgmentIdentity: null,
    failUnexpectedly: (error) => {
      failure = error instanceof Error ? error : new Error("unavailable");
      stopped = true;
    },
    isMissingPath: () => false,
    isPendingClientAlive: () => true,
    isSubmissionLeaseAlive: () => true,
    isSubmissionLeaseExpired: () => false,
    lockPath: "/lock",
    parseSubmissionLock: () => null,
    pendingResponse,
    readSubmissionFile: () => ({
      content: JSON.stringify({
        ...pendingResponse,
        client_id: "foreign-client",
      }),
      identity: foreignIdentity,
    }),
    removeOwnedFile: () => assert.fail("foreign ACK must not be removed"),
    requestChannelUnavailable: () => new Error("unavailable"),
    resolveResult: () => assert.fail("foreign ACK must not resolve"),
    responseIdentity: { dev: 77, ino: 88 },
    responsePath: "/response",
    setAcknowledgmentIdentity: (identity) => {
      sharedIdentity = identity;
    },
    setLastValidationFailure: () => {},
    settlePendingResponse: () => {},
    stopAccepting: () => {
      stopped = true;
    },
  });
  assert.equal(
    failure instanceof Error ? failure.message : null,
    "unavailable",
  );
  assert.equal(stopped, true);
  assert.equal(sharedIdentity, null);
});

test("a response publication failure cannot overturn a committed Result", async () => {
  const token = "submission-token";
  const requestPath = "/request";
  const lockPath = "/request.lock";
  const requestId = "request-1";
  const clientId = "client-1";
  const clientStartIdentity = "linux:start";
  const clientProcessGroupId = 42;
  const candidate = { result: "candidate" };
  const requestSignature = createHmac("sha256", token)
    .update(
      JSON.stringify({
        candidate,
        client_id: clientId,
        client_pid: process.pid,
        client_process_group_id: clientProcessGroupId,
        client_start_identity: clientStartIdentity,
        request_id: requestId,
      }),
    )
    .digest("base64");
  const request = {
    candidate,
    client_id: clientId,
    client_pid: process.pid,
    client_process_group_id: clientProcessGroupId,
    client_start_identity: clientStartIdentity,
    request_id: requestId,
    request_signature: requestSignature,
  };
  const lock = {
    client_id: clientId,
    client_pid: process.pid,
    client_process_group_id: clientProcessGroupId,
    client_start_identity: clientStartIdentity,
    request_id: requestId,
  };
  const responseFailure = new Error("response publication failed");
  const state = {
    accepted: false,
    committed: false,
    lastValidationFailure: null,
    pendingResponse: null,
    processing: false,
    stopped: false,
  };
  const identities = { lockIdentity: null, requestIdentity: null };
  /** @type {unknown} */
  let unexpectedFailure = null;
  /** @type {unknown} */
  let preparedCandidate = null;
  const processSubmission = createSubmissionProcessor({
    claim: { fencingToken: 7 },
    failUnexpectedly: (error) => {
      unexpectedFailure = error;
    },
    identities,
    isMissingPath: () => false,
    isProcessAlive: (pid) =>
      pid === process.pid || pid === clientProcessGroupId,
    isSubmissionLeaseAlive: () => true,
    isSubmissionLeaseExpired: () => false,
    lockPath,
    parseSubmissionLock: (submission) => JSON.parse(submission.content),
    processGroupIdentity: () => clientProcessGroupId,
    processStartIdentity: () => clientStartIdentity,
    processPendingResponse: () => false,
    readSubmissionFile: (path) => ({
      content: JSON.stringify(path === lockPath ? lock : request),
      identity: { dev: 1, ino: path === lockPath ? 2 : 3 },
      mtimeMs: Date.now(),
    }),
    removeOwnedFile: () => {},
    requestPath,
    resultService: {
      prepare: (
        /** @type {any} */ _claim,
        /** @type {unknown} */ submittedCandidate,
      ) => {
        void _claim;
        preparedCandidate = submittedCandidate;
      },
    },
    resolveResult: () => {},
    state,
    submissionChannelUnavailable: () =>
      new ReviewRunExecutionError(
        "submission_channel_unavailable",
        "unavailable",
      ),
    token,
    trustedProcessGroup: () => ({
      groupId: clientProcessGroupId,
      leaderStartIdentity: clientStartIdentity,
    }),
    writeResponse: () => {
      throw responseFailure;
    },
  });

  processSubmission();
  assert.deepEqual(preparedCandidate, candidate);
  assert.equal(state.committed, true);
  assert.equal(unexpectedFailure, responseFailure);
  const terminal = await settleSubmissionTerminal({
    channel: {
      accepted: () => false,
      hasCommittedSubmission: () => state.committed,
      hasPendingSubmission: () => false,
      waitForResult: () => new Promise(() => {}),
    },
    diagnosticFailures: [],
    async stopSubmissionChannel() {},
    terminal: { kind: "submission", result: "failed" },
  });
  assert.equal(terminal.accepted, true);
});

test("an unobserved forged response cannot hold a process terminal open", async () => {
  const checkoutPath = mkdtempSync(join(tmpdir(), "qbs-terminal-"));
  const channel = await openReviewRunSubmissionChannel(
    { fencingToken: 7, workerId: "worker-1", workId: "run-1" },
    { prepare() {} },
    { checkoutPath },
  );
  try {
    const responsePath = join(channel.commandDirectory, "response");
    writeFileSync(responsePath, "forged\n");
    assert.equal(channel.hasPendingSubmission(), false);
    const outcome = await Promise.race([
      settleSubmissionTerminal({
        channel,
        diagnosticFailures: [],
        stopSubmissionChannel: channel.stop,
        terminal: /** @type {any} */ ({
          kind: "process",
          result: { code: 1, signal: null },
        }),
      }),
      new Promise((resolve) => setTimeout(() => resolve("timeout"), 100)),
    ]);
    assert.notEqual(outcome, "timeout");
  } finally {
    let closeFailure = null;
    try {
      await channel.close();
    } catch (error) {
      closeFailure = error;
    }
    assert.ok(closeFailure instanceof Error);
    assert.match(closeFailure.message, /ENOTEMPTY|did not drain/);
    rmSync(channel.commandDirectory, { force: true, recursive: true });
    rmSync(checkoutPath, { force: true, recursive: true });
  }
});
