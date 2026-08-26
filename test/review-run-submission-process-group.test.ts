import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { test } from "node:test";

import { openReviewRunSubmissionChannel } from "../src/review/review-run-submission-channel.ts";
import { createSubmissionProcessor } from "../src/review/review-run-submission-processor.ts";
import { ReviewRunExecutionError } from "../src/review/review-run-result.ts";
import {
  isSubmissionLeaseAlive,
  processStartIdentity,
  SUBMISSION_LEASE_MILLISECONDS,
} from "../src/review/review-run-submission-files.ts";
import {
  isProcessDescendant,
  processGroupIdentity,
} from "../src/review/review-run-submission-process-group.ts";

async function terminatedProcessId() {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"]);
  await once(child, "spawn");
  const pid = child.pid;
  if (typeof pid !== "number") {
    throw new TypeError("Terminated child did not expose a PID");
  }
  child.kill();
  await once(child, "close");
  return pid;
}

test("walks a bounded parent chain to the trusted supervisor", () => {
  const parents = new Map([
    [30, 20],
    [20, 10],
    [10, 1],
  ]);
  const parentProcessId = (pid: number) => parents.get(pid) ?? null;
  assert.equal(isProcessDescendant(30, 10, parentProcessId), true);
  assert.equal(isProcessDescendant(30, 11, parentProcessId), false);
  assert.equal(isProcessDescendant(10, 10, parentProcessId), true);
  assert.equal(
    isProcessDescendant(30, 10, () => 30),
    false,
  );
});

test("rechecks dead and replaced owners even when a lease is stale", async () => {
  const processGroupId = processGroupIdentity(process.pid) as number;
  const currentStartIdentity = processStartIdentity(processGroupId);
  assert.equal(typeof currentStartIdentity, "string");
  const staleMtime = Date.now() - SUBMISSION_LEASE_MILLISECONDS - 1;
  const staleLiveLock = {
    client_id: "live",
    client_pid: process.pid,
    client_process_group_id: processGroupId,
    client_start_identity: currentStartIdentity,
    request_id: "live-request",
  };
  assert.equal(
    isSubmissionLeaseAlive({
      content: JSON.stringify(staleLiveLock),
      mtimeMs: staleMtime,
    }),
    null,
  );
  assert.equal(
    isSubmissionLeaseAlive({
      content: JSON.stringify({
        ...staleLiveLock,
        client_pid: await terminatedProcessId(),
      }),
      mtimeMs: staleMtime,
    }),
    false,
  );
  assert.equal(
    isSubmissionLeaseAlive({
      content: JSON.stringify({
        ...staleLiveLock,
        client_start_identity: "linux:replaced-process",
      }),
      mtimeMs: staleMtime,
    }),
    false,
  );
});

test("accepts a signed descendant when the sandbox starts a child process group", () => {
  const token = "submission-token";
  const requestPath = "/request";
  const lockPath = "/request.lock";
  const requestId = "request-1";
  const clientId = "client-1";
  const leaderStartIdentity = "ps:leader-start";
  const clientProcessGroupId = 42;
  const candidate = { result: "candidate" };
  const payload = {
    candidate,
    client_id: clientId,
    client_pid: process.pid,
    client_process_group_id: clientProcessGroupId,
    client_start_identity: leaderStartIdentity,
    request_id: requestId,
  };
  const request = {
    ...payload,
    request_signature: createHmac("sha256", token)
      .update(JSON.stringify(payload))
      .digest("base64"),
  };
  const lock = {
    client_id: clientId,
    client_pid: process.pid,
    client_process_group_id: clientProcessGroupId,
    client_start_identity: leaderStartIdentity,
    request_id: requestId,
  };
  const state = {
    accepted: false,
    committed: false,
    lastValidationFailure: null,
    pendingResponse: null,
    processing: false,
    stopped: false,
  };
  let prepared = false;
  let failed = false;
  const processSubmission = createSubmissionProcessor({
    claim: { fencingToken: 7 },
    failUnexpectedly: () => (failed = true),
    identities: { lockIdentity: null, requestIdentity: null },
    isMissingPath: () => false,
    isProcessAlive: () => true,
    isProcessDescendant: () => true,
    isSubmissionLeaseAlive: () => true,
    isSubmissionLeaseExpired: () => false,
    lockPath,
    parseSubmissionLock: (submission) => JSON.parse(submission.content),
    processGroupIdentity: (pid) =>
      pid === process.pid ? clientProcessGroupId + 1 : clientProcessGroupId,
    processStartIdentity: (pid) =>
      pid === process.pid ? "ps:client-start" : leaderStartIdentity,
    processPendingResponse: () => false,
    readSubmissionFile: (path) => ({
      content: JSON.stringify(path === lockPath ? lock : request),
      identity: { dev: 1, ino: path === lockPath ? 2 : 3 },
      mtimeMs: Date.now(),
    }),
    removeOwnedFile: () => {},
    requestPath,
    resultService: { prepare: () => (prepared = true) },
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
      leaderStartIdentity,
    }),
    writeResponse: () => {},
  });

  processSubmission();
  assert.equal(failed, false);
  assert.equal(prepared, true);
  assert.equal(state.committed, true);
});

test("rejects a signed submission from outside the supervised process group", async (context) => {
  const checkoutPath = mkdtempSync(join(tmpdir(), "qbs-process-group-"));
  context.after(() => rmSync(checkoutPath, { force: true, recursive: true }));
  let prepared = 0;
  const channel = await openReviewRunSubmissionChannel(
    { fencingToken: 7, workerId: "worker-1", workId: "run-1" },
    { prepare: () => (prepared += 1) },
    { checkoutPath },
  );
  const leader = spawn(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)"],
    {
      detached: true,
      stdio: "ignore",
    },
  );
  await once(leader, "spawn");
  channel.bindProcessGroup(leader.pid as number);
  writeFileSync(join(checkoutPath, ".quality-bar-result.json"), "{}\n");
  try {
    const stderr = await new Promise((resolve) => {
      execFile(
        "quality-bar-submit",
        [".quality-bar-result.json"],
        {
          cwd: checkoutPath,
          env: {
            ...channel.environment,
            PATH: [
              channel.commandDirectory,
              dirname(process.execPath),
              "/usr/bin",
              "/bin",
            ].join(delimiter),
          },
        },
        (...callbackArguments) =>
          resolve(callbackArguments[0] ? callbackArguments[2] : ""),
      );
    });
    assert.equal(
      stderr,
      "submission_channel_unavailable: Review Run submission channel is unavailable\n",
    );
    assert.equal(await channel.waitForResult(), "failed");
    assert.equal(prepared, 0);
  } finally {
    await channel.close();
    try {
      process.kill(-(leader.pid as number), "SIGKILL");
    } catch (error) {
      assert.equal(
        error instanceof Error && "code" in error ? error.code : null,
        "ESRCH",
      );
    }
  }
});
