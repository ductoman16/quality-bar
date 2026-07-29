import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "node:test";

import { runReviewRunCodex } from "./review-run-codex-adapter-support.js";

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

test("process-group signaling failure cannot replace the recorded deadline", async () => {
  /** @type {(string | number)[]} */
  const events = [];
  const child = runningProcess(83);
  const terminationFailure = Object.assign(new Error("kill not permitted"), {
    code: "EPERM",
  });
  /** @type {Error | undefined} */
  let recordedDeadline;
  await assert.rejects(
    () =>
      runReviewRunCodex({
        checkoutPath: "/checkout",
        claim,
        clearDeadlineTimer() {},
        killProcessGroup(pid, signal) {
          assert.equal(pid, -83);
          events.push(signal);
          throw terminationFailure;
        },
        openSubmissionChannel: async () => ({
          ...acceptedChannel(),
          accepted: () => false,
          async close() {
            events.push("submission-closed");
          },
          waitForResult: () => new Promise(() => {}),
        }),
        recordDeadline(failure) {
          recordedDeadline = failure;
          events.push("deadline-recorded");
        },
        resultService: { prepare() {} },
        run,
        setDeadlineTimer(callback) {
          queueMicrotask(callback);
          return {};
        },
        spawnProcess: () => /** @type {any} */ (child),
      }),
    (error) => {
      assert.equal(error, recordedDeadline);
      assert.equal(
        /** @type {any} */ (error).processTerminationFailure,
        terminationFailure,
      );
      return true;
    },
  );
  assert.deepEqual(events, [
    "submission-closed",
    "deadline-recorded",
    "SIGTERM",
  ]);
});

test("a Result accepted before the deadline close keeps authority", async () => {
  /** @type {(string | number)[]} */
  const events = [];
  const child = runningProcess(84);
  await runReviewRunCodex({
    checkoutPath: "/checkout",
    claim,
    clearDeadlineTimer() {},
    killProcessGroup(pid, signal) {
      assert.equal(pid, -84);
      events.push(signal);
      if (signal === "SIGTERM") {
        queueMicrotask(() => child.emit("close", null, "SIGTERM"));
        return;
      }
      assert.equal(signal, 0);
      throw Object.assign(new Error("process group exited"), { code: "ESRCH" });
    },
    openSubmissionChannel: async () => ({
      ...acceptedChannel(),
      async close() {
        events.push("submission-closed");
      },
      waitForResult: () =>
        new Promise((resolve) => {
          setImmediate(() => resolve("accepted"));
        }),
    }),
    recordDeadline() {
      assert.fail("an accepted Result was replaced by the deadline");
    },
    resultService: { prepare() {} },
    run,
    setDeadlineTimer(callback) {
      queueMicrotask(callback);
      return {};
    },
    spawnProcess: () => /** @type {any} */ (child),
  });
  assert.deepEqual(events, ["submission-closed", "SIGTERM", 0]);
});
