import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "node:test";

import { ReviewRunExecutionError } from "../src/review-run-result.js";
import {
  claim,
  run,
  runReviewRunCodex,
} from "./review-run-codex-adapter-support.js";

/** @param {string} stderr */
function processThatExitsWithStderr(stderr) {
  const child = new EventEmitter();
  const process = Object.assign(child, {
    pid: 78,
    stderr: new PassThrough(),
    stdout: new PassThrough(),
  });
  queueMicrotask(() => {
    process.stderr.end(stderr);
    child.emit("close", 1, null);
  });
  return process;
}

/** @param {{failure?: Error | null, result?: "failed"}} [options] */
function channel({ failure = null, result } = {}) {
  return {
    accepted: () => false,
    async close() {},
    commandDirectory: "/submit-bin",
    environment: {
      QUALITY_BAR_SUBMIT_SOCKET: "/socket",
      QUALITY_BAR_SUBMIT_TOKEN: "secret",
    },
    failure: () => failure,
    lastValidationFailure: () => null,
    waitForResult: () =>
      result === "failed" ? Promise.resolve(result) : new Promise(() => {}),
  };
}

test("maps uncoded and generic coded submission failures safely", async () => {
  for (const submissionFailure of [
    new Error("submission socket exposed secret"),
    Object.assign(new Error("broken socket secret"), { code: "EPIPE" }),
  ]) {
    await assert.rejects(
      () =>
        runReviewRunCodex({
          checkoutPath: "/checkout",
          claim,
          openSubmissionChannel: async () =>
            channel({ failure: submissionFailure }),
          resultService: { prepare() {} },
          run,
          spawnProcess: () =>
            /** @type {any} */ (processThatExitsWithStderr("")),
        }),
      (error) => {
        assert.ok(error instanceof ReviewRunExecutionError);
        assert.equal(error.code, "submission_failed");
        assert.equal(error.message, "Review Run submission failed");
        assert.equal(error.cause, submissionFailure);
        assert.doesNotMatch(error.message, /secret/);
        return true;
      },
    );
  }
});

test("a failed submission closes and terminates a running Codex process", async () => {
  /** @type {(string | number)[]} */
  const events = [];
  /** @type {unknown[]} */
  const evidence = [];
  const child = Object.assign(new EventEmitter(), {
    pid: 79,
    stderr: new PassThrough(),
    stdout: new PassThrough(),
  });
  await assert.rejects(
    () =>
      runReviewRunCodex({
        checkoutPath: "/checkout",
        claim,
        evidenceService: {
          appendTranscriptChunk() {},
          complete(evidenceClaim, facts) {
            assert.deepEqual(evidenceClaim, claim);
            events.push("evidence");
            evidence.push(facts);
          },
        },
        killProcessGroup(pid, signal) {
          assert.equal(pid, -79);
          if (signal === "SIGTERM") {
            events.push("SIGTERM");
            queueMicrotask(() => child.emit("close", null, "SIGTERM"));
            return;
          }
          assert.equal(signal, 0);
          throw Object.assign(new Error("process group exited"), {
            code: "ESRCH",
          });
        },
        openSubmissionChannel: async () => ({
          ...channel({ result: "failed" }),
          async close() {
            events.push("close");
          },
        }),
        resultService: { prepare() {} },
        run,
        spawnProcess: () => /** @type {any} */ (child),
      }),
    (error) => {
      assert.ok(error instanceof ReviewRunExecutionError);
      assert.equal(error.code, "submission_failed");
      return true;
    },
  );
  assert.deepEqual(events, ["close", "SIGTERM", "evidence"]);
  assert.deepEqual(evidence, [
    {
      exitCode: null,
      signal: "SIGTERM",
      tokenCounters: {
        cached_input_tokens: null,
        input_tokens: null,
        output_tokens: null,
      },
    },
  ]);
});

test("a failed submission retains a post-close termination diagnostic", async () => {
  const terminationFailure = Object.assign(
    new Error("process group liveness unavailable"),
    { code: "EPERM" },
  );
  /** @type {string[]} */
  const events = [];
  const child = Object.assign(new EventEmitter(), {
    pid: 80,
    stderr: new PassThrough(),
    stdout: new PassThrough(),
  });
  await assert.rejects(
    () =>
      runReviewRunCodex({
        checkoutPath: "/checkout",
        claim,
        evidenceService: {
          appendTranscriptChunk() {},
          complete(evidenceClaim, facts) {
            assert.deepEqual(evidenceClaim, claim);
            assert.equal(/** @type {any} */ (facts).signal, "SIGTERM");
            events.push("evidence");
          },
        },
        killProcessGroup(pid, signal) {
          assert.equal(pid, -80);
          events.push(String(signal));
          if (signal === "SIGTERM") {
            queueMicrotask(() => child.emit("close", null, "SIGTERM"));
            return;
          }
          if (signal === 0) {
            throw terminationFailure;
          }
          assert.equal(signal, "SIGKILL");
        },
        openSubmissionChannel: async () => ({
          ...channel({ result: "failed" }),
          async close() {
            events.push("close");
          },
        }),
        resultService: { prepare() {} },
        run,
        setTerminationTimer(callback) {
          queueMicrotask(callback);
          return {};
        },
        spawnProcess: () => /** @type {any} */ (child),
      }),
    (error) => {
      assert.ok(error instanceof ReviewRunExecutionError);
      assert.equal(error.code, "submission_failed");
      assert.equal(
        /** @type {any} */ (error).processTerminationFailure,
        terminationFailure,
      );
      return true;
    },
  );
  assert.deepEqual(events, ["close", "SIGTERM", "SIGKILL", "0", "evidence"]);
});

test("a failed submission retains an evidence completion diagnostic", async () => {
  const evidenceFailure = Object.assign(new Error("evidence write failed"), {
    code: "storage_unavailable",
  });
  const child = Object.assign(new EventEmitter(), {
    pid: 81,
    stderr: new PassThrough(),
    stdout: new PassThrough(),
  });
  await assert.rejects(
    () =>
      runReviewRunCodex({
        checkoutPath: "/checkout",
        claim,
        evidenceService: {
          appendTranscriptChunk() {},
          complete() {
            throw evidenceFailure;
          },
        },
        killProcessGroup(pid, signal) {
          assert.equal(pid, -81);
          if (signal === "SIGTERM") {
            queueMicrotask(() => child.emit("close", null, "SIGTERM"));
            return;
          }
          assert.equal(signal, 0);
          throw Object.assign(new Error("process group exited"), {
            code: "ESRCH",
          });
        },
        openSubmissionChannel: async () => channel({ result: "failed" }),
        resultService: { prepare() {} },
        run,
        spawnProcess: () => /** @type {any} */ (child),
      }),
    (error) => {
      assert.ok(error instanceof ReviewRunExecutionError);
      assert.equal(error.code, "submission_failed");
      assert.equal(
        /** @type {any} */ (error).evidenceCompletionFailure,
        evidenceFailure,
      );
      return true;
    },
  );
});

test("a failed submission retains transcript failure without duplicate termination", async () => {
  const transcriptFailure = Object.assign(
    new Error("transcript persistence failed"),
    { code: "storage_unavailable" },
  );
  const child = Object.assign(new EventEmitter(), {
    pid: 83,
    stderr: new PassThrough(),
    stdout: new PassThrough(),
  });
  let terminationSignals = 0;
  await assert.rejects(
    () =>
      runReviewRunCodex({
        checkoutPath: "/checkout",
        claim,
        evidenceService: {
          appendTranscriptChunk() {
            throw transcriptFailure;
          },
          complete() {},
        },
        killProcessGroup(pid, signal) {
          assert.equal(pid, -83);
          if (signal === "SIGTERM") {
            terminationSignals += 1;
            child.stderr.write("shutdown diagnostic\n");
            queueMicrotask(() => child.emit("close", null, "SIGTERM"));
            return;
          }
          assert.equal(signal, 0);
          throw Object.assign(new Error("process group exited"), {
            code: "ESRCH",
          });
        },
        openSubmissionChannel: async () => channel({ result: "failed" }),
        resultService: { prepare() {} },
        run,
        spawnProcess: () => /** @type {any} */ (child),
      }),
    (error) => {
      assert.ok(error instanceof ReviewRunExecutionError);
      assert.equal(error.code, "submission_failed");
      assert.equal(
        /** @type {any} */ (error).transcriptFailure,
        transcriptFailure,
      );
      return true;
    },
  );
  assert.equal(terminationSignals, 1);
});

test("preserves a coded submission storage failure", async () => {
  const storageFailure = Object.assign(new Error("sqlite write failed"), {
    code: "storage_unavailable",
  });
  await assert.rejects(
    () =>
      runReviewRunCodex({
        checkoutPath: "/checkout",
        claim,
        openSubmissionChannel: async () => channel({ failure: storageFailure }),
        resultService: { prepare() {} },
        run,
        spawnProcess: () => /** @type {any} */ (processThatExitsWithStderr("")),
      }),
    (error) => error === storageFailure,
  );
});

test("a direct child exit closes submission and terminates surviving descendants", async () => {
  const child = Object.assign(new EventEmitter(), {
    pid: 87,
    stderr: new PassThrough(),
    stdout: new PassThrough(),
  });
  /** @type {(string | number)[]} */
  const events = [];
  let closed = false;
  let lateAcceptance = false;
  await assert.rejects(
    () =>
      runReviewRunCodex({
        checkoutPath: "/checkout",
        claim,
        clearTerminationTimer() {},
        killProcessGroup(pid, signal) {
          assert.equal(pid, -87);
          events.push(signal);
          if (signal === "SIGTERM") {
            lateAcceptance = !closed;
          }
        },
        openSubmissionChannel: async () => ({
          accepted: () => lateAcceptance,
          async close() {
            closed = true;
            events.push("submission-closed");
          },
          commandDirectory: "/submit-bin",
          environment: {},
          failure: () => null,
          lastValidationFailure: () => null,
          waitForResult: () => new Promise(() => {}),
        }),
        resultService: { prepare() {} },
        run,
        setTerminationTimer(callback, milliseconds) {
          assert.equal(milliseconds, 5_000);
          setImmediate(callback);
          return {};
        },
        spawnProcess() {
          queueMicrotask(() => child.emit("close", 0, null));
          return /** @type {any} */ (child);
        },
      }),
    (error) =>
      error instanceof ReviewRunExecutionError &&
      error.code === "result_not_submitted",
  );
  assert.equal(lateAcceptance, false);
  assert.deepEqual(events, ["submission-closed", "SIGTERM", 0, "SIGKILL"]);
});
