import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "node:test";

import { runReviewRunCodex } from "../src/review-run-codex-adapter.js";

const claim = Object.freeze({
  fencingToken: 7,
  workerId: "worker-1",
  workId: "run-1",
});
const run = Object.freeze({
  configuration: {
    model: "gpt-5.6-terra",
    reasoning_effort: "high",
    service_tier: "fast",
  },
  criteria: [{ criterionId: "criterion-1" }],
  prompt: "Review the frozen Changeset",
});

function acceptedChannel() {
  return {
    accepted: () => true,
    async close() {},
    commandDirectory: "/submit-bin",
    environment: {
      QUALITY_BAR_SUBMIT_SOCKET: "/socket",
      QUALITY_BAR_SUBMIT_TOKEN: "secret",
    },
    failure: () => null,
    lastValidationFailure: () => null,
    waitForResult: () =>
      Promise.resolve(/** @type {"accepted"} */ ("accepted")),
  };
}

/** @param {number} pid */
function runningProcess(pid) {
  return Object.assign(new EventEmitter(), {
    pid,
    stderr: new PassThrough(),
    stdout: new PassThrough(),
  });
}

test("accepted submission force-kills a Codex process group after five seconds", async () => {
  /** @type {string[]} */
  const signals = [];
  const child = runningProcess(74);
  await runReviewRunCodex({
    checkoutPath: "/checkout",
    claim,
    clearTerminationTimer() {},
    killProcessGroup(pid, signal) {
      assert.equal(pid, -74);
      signals.push(signal);
      if (signal === "SIGKILL") {
        queueMicrotask(() => child.emit("exit", null, "SIGKILL"));
      }
    },
    openSubmissionChannel: async () => acceptedChannel(),
    resultService: { submit() {} },
    run,
    setTerminationTimer(callback, milliseconds) {
      assert.equal(milliseconds, 5_000);
      queueMicrotask(callback);
      return { unref() {} };
    },
    spawnProcess: () => /** @type {any} */ (child),
  });
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
});

test("an already-exited process group cannot overturn an accepted Result", async () => {
  const child = runningProcess(75);
  await runReviewRunCodex({
    checkoutPath: "/checkout",
    claim,
    killProcessGroup() {
      queueMicrotask(() => child.emit("exit", 0, null));
      throw Object.assign(new Error("process already exited"), {
        code: "ESRCH",
      });
    },
    openSubmissionChannel: async () => acceptedChannel(),
    resultService: { submit() {} },
    run,
    spawnProcess: () => /** @type {any} */ (child),
  });
});
