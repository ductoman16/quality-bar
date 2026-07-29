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
  /** @type {(string | number)[]} */
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
      return {
        unref() {
          assert.fail("the load-bearing termination timer was unreferenced");
        },
      };
    },
    spawnProcess: () => /** @type {any} */ (child),
  });
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
});

test("a direct child exit does not spare a surviving process-group descendant", async () => {
  /** @type {(string | number)[]} */
  const signals = [];
  const child = runningProcess(75);
  await runReviewRunCodex({
    checkoutPath: "/checkout",
    claim,
    clearTerminationTimer() {},
    killProcessGroup(pid, signal) {
      assert.equal(pid, -75);
      signals.push(signal);
      if (signal === "SIGTERM") {
        queueMicrotask(() => child.emit("exit", 0, null));
      }
    },
    openSubmissionChannel: async () => acceptedChannel(),
    resultService: { submit() {} },
    run,
    setTerminationTimer(callback, milliseconds) {
      assert.equal(milliseconds, 5_000);
      setImmediate(callback);
      return { unref() {} };
    },
    spawnProcess: () => /** @type {any} */ (child),
  });
  assert.deepEqual(signals, ["SIGTERM", 0, "SIGKILL"]);
});

test("process-first acceptance still terminates a surviving group descendant", async () => {
  /** @type {(string | number)[]} */
  const signals = [];
  const child = runningProcess(76);
  await runReviewRunCodex({
    checkoutPath: "/checkout",
    claim,
    clearTerminationTimer() {},
    killProcessGroup(pid, signal) {
      assert.equal(pid, -76);
      signals.push(signal);
    },
    openSubmissionChannel: async () => ({
      ...acceptedChannel(),
      waitForResult: () =>
        new Promise((resolve) => {
          setImmediate(() => resolve("accepted"));
        }),
    }),
    resultService: { submit() {} },
    run,
    setTerminationTimer(callback, milliseconds) {
      assert.equal(milliseconds, 5_000);
      setImmediate(callback);
      return { unref() {} };
    },
    spawnProcess() {
      queueMicrotask(() => child.emit("exit", 0, null));
      return /** @type {any} */ (child);
    },
  });
  assert.deepEqual(signals, ["SIGTERM", 0, "SIGKILL"]);
});

test("an already-exited process group cannot overturn an accepted Result", async () => {
  const child = runningProcess(77);
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

test("termination failure stays diagnostic after an accepted Result", async () => {
  const terminationFailure = Object.assign(new Error("kill not permitted"), {
    code: "EPERM",
  });
  const child = runningProcess(78);
  assert.deepEqual(
    await runReviewRunCodex({
      checkoutPath: "/checkout",
      claim,
      killProcessGroup() {
        throw terminationFailure;
      },
      openSubmissionChannel: async () => acceptedChannel(),
      resultService: { submit() {} },
      run,
      spawnProcess: () => /** @type {any} */ (child),
    }),
    { diagnosticFailures: [terminationFailure] },
  );
});
