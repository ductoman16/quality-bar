import assert from "node:assert/strict";
import { test } from "node:test";

import { runReviewRunCodex as runCodexAdapter } from "../src/review/review-run-codex-adapter.js";
import {
  acceptedChannel,
  claim,
  run,
  runningProcess,
  runReviewRunCodex,
} from "./review-run-codex-adapter-support.js";

test("the exported adapter requires durable deadline recording before opening submission", async () => {
  let submissionOpened = false;
  await assert.rejects(
    () =>
      runCodexAdapter(
        /** @type {any} */ ({
          checkoutPath: "/checkout",
          claim,
          openSubmissionChannel() {
            submissionOpened = true;
          },
          resultService: { prepare() {} },
          run,
          startRun() {},
        }),
      ),
    /Review Run deadline recorder is required/,
  );
  assert.equal(submissionOpened, false);
});

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

test("post-deadline evidence and submission failures remain diagnostics on the deadline", async () => {
  const child = runningProcess(85);
  const evidenceFailure = new Error("evidence completion failed");
  const submissionFailure = new Error("submission channel failed");
  const transcriptFailure = new Error("transcript append failed");
  /** @type {Error | undefined} */
  let recordedDeadline;
  await assert.rejects(
    () =>
      runReviewRunCodex({
        checkoutPath: "/checkout",
        claim,
        clearDeadlineTimer() {},
        killProcessGroup(pid, signal) {
          assert.equal(pid, -85);
          if (signal === "SIGTERM") {
            child.stdout.write("late transcript");
            queueMicrotask(() => child.emit("close", null, "SIGTERM"));
            return;
          }
          throw Object.assign(new Error("process group exited"), {
            code: "ESRCH",
          });
        },
        evidenceService: {
          appendTranscriptChunk() {
            throw transcriptFailure;
          },
          complete() {
            throw evidenceFailure;
          },
        },
        openSubmissionChannel: async () => ({
          ...acceptedChannel(),
          accepted: () => false,
          failure: () => submissionFailure,
          waitForResult: () => new Promise(() => {}),
        }),
        recordDeadline(failure) {
          recordedDeadline = failure;
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
        /** @type {any} */ (error).evidenceCompletionFailure,
        evidenceFailure,
      );
      assert.equal(
        /** @type {any} */ (error).submissionFailure,
        submissionFailure,
      );
      assert.equal(
        /** @type {any} */ (error).transcriptFailure,
        transcriptFailure,
      );
      return true;
    },
  );
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
