import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { test } from "node:test";

import { openReviewRunSubmissionChannel } from "../src/review-run-submission-channel.js";
import {
  isSubmissionLeaseAlive,
  processStartIdentity,
  SUBMISSION_LEASE_MILLISECONDS,
} from "../src/review-run-submission-files.js";
import { processGroupIdentity } from "../src/review-run-submission-process-group.js";

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

test("rechecks dead and replaced owners even when a lease is stale", async () => {
  const currentStartIdentity = processStartIdentity(process.pid);
  assert.equal(typeof currentStartIdentity, "string");
  const staleMtime = Date.now() - SUBMISSION_LEASE_MILLISECONDS - 1;
  const staleLiveLock = {
    client_id: "live",
    client_pid: process.pid,
    client_process_group_id: processGroupIdentity(process.pid),
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
  channel.bindProcessGroup(/** @type {number} */ (leader.pid));
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
      process.kill(-(/** @type {number} */ (leader.pid)), "SIGKILL");
    } catch (error) {
      assert.equal(
        error instanceof Error && "code" in error ? error.code : null,
        "ESRCH",
      );
    }
  }
});
