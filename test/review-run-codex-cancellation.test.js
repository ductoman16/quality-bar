import assert from "node:assert/strict";
import { test } from "node:test";

import { ReviewRunExecutionError } from "../src/review-run-result.js";
import {
  acceptedChannel,
  claim,
  run,
  runningProcess,
  runReviewRunCodex,
} from "./review-run-codex-adapter-support.js";

test("durably committed operator cancellation closes submission before process-group termination", async () => {
  /** @type {(string | number)[]} */
  /** @type {(string | number)[]} */
  const events = [];
  const child = runningProcess(83);
  /** @type {(value?: void) => void} */
  let signalCancellation = () =>
    assert.fail("cancellation signal was not installed");
  const cancellationSignal = new Promise((resolve) => {
    signalCancellation = resolve;
  });
  const execution = runReviewRunCodex({
    cancellationSignal,
    checkoutPath: "/checkout",
    claim,
    clearTerminationTimer() {},
    killProcessGroup(pid, signal) {
      assert.equal(pid, -83);
      events.push(signal);
      if (signal === "SIGKILL") {
        queueMicrotask(() => child.emit("close", null, "SIGKILL"));
      }
    },
    openSubmissionChannel: async () => ({
      ...acceptedChannel(),
      accepted: () => false,
      async close() {
        events.push("submission-closed");
      },
      waitForResult: () => new Promise(() => {}),
    }),
    resultService: { prepare() {} },
    run,
    setTerminationTimer(callback, milliseconds) {
      assert.equal(milliseconds, 5_000);
      queueMicrotask(callback);
      return {};
    },
    spawnProcess: () => /** @type {any} */ (child),
  });
  signalCancellation();
  assert.deepEqual(await execution, {
    cancelled: true,
    diagnosticFailures: [],
  });
  assert.deepEqual(events, ["submission-closed", "SIGTERM", "SIGKILL"]);
});

test("operator cancellation surfaces submission-channel cleanup failure", async () => {
  const cleanupFailure = { owner: "submission cleanup" };
  const evidenceFailure = { owner: "evidence completion" };
  const child = runningProcess(84);
  /** @type {(value?: void) => void} */
  let signalCancellation = () =>
    assert.fail("cancellation signal was not installed");
  const cancellationSignal = new Promise((resolve) => {
    signalCancellation = resolve;
  });
  const execution = runReviewRunCodex({
    cancellationSignal,
    checkoutPath: "/checkout",
    claim,
    clearTerminationTimer() {},
    killProcessGroup(pid, signal) {
      assert.equal(pid, -84);
      if (signal === "SIGTERM") {
        queueMicrotask(() => child.emit("close", null, "SIGTERM"));
        return;
      }
      assert.equal(signal, 0);
      throw Object.assign(new Error("process group exited"), { code: "ESRCH" });
    },
    openSubmissionChannel: async () => ({
      ...acceptedChannel(),
      accepted: () => false,
      async close() {
        throw cleanupFailure;
      },
      waitForResult: () => new Promise(() => {}),
    }),
    evidenceService: {
      appendTranscriptChunk() {},
      complete() {
        throw evidenceFailure;
      },
    },
    resultService: { prepare() {} },
    run,
    spawnProcess: () => /** @type {any} */ (child),
  });
  signalCancellation();
  const result = await execution;
  assert.ok("cancelled" in result);
  assert.equal(result.cancelled, true);
  assert.equal(
    result.diagnosticFailures[0]?.message,
    "Review Run submission channel cleanup failed",
  );
  assert.equal(result.diagnosticFailures[0]?.cause, cleanupFailure);
  assert.equal(
    result.diagnosticFailures[1]?.message,
    "Review Run evidence completion failed",
  );
  assert.equal(result.diagnosticFailures[1]?.cause, evidenceFailure);
});

test("operator cancellation preserves non-Error process termination cause", async () => {
  const terminationFailure = { owner: "process termination" };
  const child = runningProcess(85);
  /** @type {(value?: void) => void} */
  let signalCancellation = () =>
    assert.fail("cancellation signal was not installed");
  const cancellationSignal = new Promise((resolve) => {
    signalCancellation = resolve;
  });
  const execution = runReviewRunCodex({
    cancellationSignal,
    checkoutPath: "/checkout",
    claim,
    killProcessGroup() {
      throw terminationFailure;
    },
    openSubmissionChannel: async () => ({
      ...acceptedChannel(),
      accepted: () => false,
      waitForResult: () => new Promise(() => {}),
    }),
    resultService: { prepare() {} },
    run,
    spawnProcess: () => /** @type {any} */ (child),
  });
  signalCancellation();
  await assert.rejects(execution, (error) => {
    assert.ok(error instanceof ReviewRunExecutionError);
    assert.equal(error.code, "codex_process_failed");
    assert.ok(error.cause instanceof Error);
    assert.equal(error.cause.message, "Codex process-group termination failed");
    assert.equal(error.cause.cause, terminationFailure);
    return true;
  });
});

test("cancellation retains ownership when termination reveals transcript failure", async () => {
  const storageFailure = Object.assign(new Error("transcript write failed"), {
    code: "storage_unavailable",
  });
  const child = runningProcess(86);
  /** @type {(value?: void) => void} */
  let signalCancellation = () =>
    assert.fail("cancellation signal was not installed");
  const cancellationSignal = new Promise((resolve) => {
    signalCancellation = resolve;
  });
  /** @type {(string | number)[]} */
  const events = [];
  const execution = runReviewRunCodex({
    cancellationSignal,
    checkoutPath: "/checkout",
    claim,
    clearTerminationTimer() {},
    evidenceService: {
      appendTranscriptChunk() {
        events.push("transcript-failed");
        throw storageFailure;
      },
      complete() {},
    },
    killProcessGroup(pid, signal) {
      assert.equal(pid, -86);
      events.push(signal);
      if (signal === "SIGTERM") {
        child.stdout.write("late transcript\n");
        queueMicrotask(() => child.emit("close", null, "SIGTERM"));
        return;
      }
      throw Object.assign(new Error("process group exited"), { code: "ESRCH" });
    },
    openSubmissionChannel: async () => ({
      ...acceptedChannel(),
      accepted: () => false,
      async close() {
        events.push("submission-closed");
      },
      waitForResult: () => new Promise(() => {}),
    }),
    resultService: { prepare() {} },
    run,
    spawnProcess: () => /** @type {any} */ (child),
  });
  signalCancellation();
  const result = await execution;
  assert.deepEqual(result, {
    cancelled: true,
    diagnosticFailures: [storageFailure],
  });
  assert.deepEqual(events, [
    "submission-closed",
    "SIGTERM",
    "transcript-failed",
    0,
  ]);
});
