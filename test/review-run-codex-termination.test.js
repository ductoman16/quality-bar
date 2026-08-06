import assert from "node:assert/strict";
import { test } from "node:test";

import { createCodexProcessFailure } from "../src/review-run-codex-failure.js";
import { terminateReviewRunProcessGroup } from "../src/review-run-process-group.js";
import { ReviewRunExecutionError } from "../src/review-run-result.js";
import {
  acceptedChannel,
  claim,
  run,
  runningProcess,
  runReviewRunCodex,
} from "./review-run-codex-adapter-support.js";

test("a process error without transcript preserves secret-safe detail", () => {
  const processError = new Error("spawn failed for secret");
  const failure = createCodexProcessFailure(
    { code: 127, error: processError, signal: null, stderr: "", stdout: "" },
    { QUALITY_BAR_SUBMIT_TOKEN: "secret" },
  );
  assert.equal(failure.code, "codex_process_failed");
  assert.equal(failure.message, "spawn failed for [REDACTED]");
  assert.equal(/** @type {any} */ (failure.cause).processError, processError);
});

test("closed supervisor IPC still proves that the process group exited", async () => {
  /** @type {(string | number)[]} */
  const signals = [];
  await terminateReviewRunProcessGroup({
    child: /** @type {any} */ ({ pid: 72 }),
    clearTerminationTimer() {},
    async finishSupervisor() {
      throw Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
    },
    killProcessGroup(pid, signal) {
      assert.equal(pid, -72);
      signals.push(signal);
      if (signal === 0) {
        throw Object.assign(new Error("process group exited"), {
          code: "ESRCH",
        });
      }
    },
    processResult: Promise.resolve({ code: 0, signal: null }),
    setTerminationTimer() {
      return {};
    },
  });
  assert.deepEqual(signals, ["SIGTERM", 0]);
});

test("a synchronous post-start launch failure retains exact evidence", async () => {
  const processError = new Error("spawn failed for secret");
  /** @type {any[]} */
  const evidence = [];
  await assert.rejects(
    () =>
      runReviewRunCodex({
        checkoutPath: "/checkout",
        claim,
        evidenceService: {
          appendTranscriptChunk() {
            assert.fail("a synchronous launch has no transcript");
          },
          complete(evidenceClaim, facts) {
            assert.deepEqual(evidenceClaim, claim);
            evidence.push(facts);
          },
        },
        openSubmissionChannel: async () => ({
          accepted: () => false,
          bindProcessGroup() {},
          async close() {},
          commandDirectory: "/submit-bin",
          environment: { QUALITY_BAR_SUBMIT_TOKEN: "secret" },
          failure: () => null,
          lastValidationFailure: () => null,
          waitForResult: () => new Promise(() => {}),
        }),
        resultService: { prepare() {} },
        run,
        spawnProcess() {
          throw processError;
        },
      }),
    (error) => {
      assert.ok(error instanceof ReviewRunExecutionError);
      assert.equal(error.code, "codex_process_failed");
      assert.equal(error.message, "spawn failed for [REDACTED]");
      assert.equal(/** @type {any} */ (error.cause).processError, processError);
      return true;
    },
  );
  assert.deepEqual(evidence, [
    {
      exitCode: null,
      signal: null,
      tokenCounters: {
        cached_input_tokens: null,
        input_tokens: null,
        output_tokens: null,
      },
    },
  ]);
});

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
        queueMicrotask(() => child.emit("close", null, "SIGKILL"));
      }
    },
    openSubmissionChannel: async () => acceptedChannel(),
    resultService: { prepare() {} },
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

test(
  "the fixed fifteen-minute deadline closes submission before terminating and force-killing the process group",
  { timeout: 1_000 },
  async () => {
    /** @type {(string | number)[]} */
    const events = [];
    const child = runningProcess(80);
    await assert.rejects(
      () =>
        runReviewRunCodex({
          checkoutPath: "/checkout",
          claim,
          clearDeadlineTimer() {},
          clearTerminationTimer() {},
          killProcessGroup(pid, signal) {
            assert.equal(pid, -80);
            events.push(signal);
            if (signal === "SIGKILL") {
              queueMicrotask(() => child.emit("close", null, "SIGKILL"));
            }
          },
          openSubmissionChannel: async () => ({
            ...acceptedChannel(),
            accepted: () => false,
            bindProcessGroup() {},
            async close() {
              events.push("submission-closed");
            },
            waitForResult: () => new Promise(() => {}),
          }),
          recordDeadline(failure) {
            assert.equal(failure.code, "deadline_exceeded");
            events.push("deadline-recorded");
          },
          resultService: { prepare() {} },
          run,
          setDeadlineTimer(callback, milliseconds) {
            assert.equal(milliseconds, 15 * 60 * 1_000);
            events.push("deadline-started");
            queueMicrotask(callback);
            return {};
          },
          setTerminationTimer(callback, milliseconds) {
            assert.equal(milliseconds, 5_000);
            queueMicrotask(callback);
            return {};
          },
          spawnProcess() {
            events.push("spawn");
            return /** @type {any} */ (child);
          },
        }),
      (error) =>
        error instanceof ReviewRunExecutionError &&
        error.code === "deadline_exceeded" &&
        error.message === "Codex Review Run exceeded its 15-minute deadline",
    );
    assert.deepEqual(events, [
      "deadline-started",
      "spawn",
      "submission-closed",
      "deadline-recorded",
      "SIGTERM",
      "SIGKILL",
    ]);
  },
);

test("parallel Review Runs own independent deadline timers", async () => {
  /** @type {(() => void)[]} */
  const deadlines = [];
  /** @type {number[]} */
  const terminated = [];
  /** @param {number} pid */
  function runUntilDeadline(pid) {
    const child = runningProcess(pid);
    return runReviewRunCodex({
      checkoutPath: "/checkout",
      claim: { ...claim, workId: `run-${pid}` },
      clearDeadlineTimer() {},
      killProcessGroup(processGroupId, signal) {
        assert.equal(processGroupId, -pid);
        if (signal === "SIGTERM") {
          terminated.push(pid);
          queueMicrotask(() => child.emit("close", null, "SIGTERM"));
        } else {
          assert.equal(signal, 0);
          throw Object.assign(new Error("process group exited"), {
            code: "ESRCH",
          });
        }
      },
      openSubmissionChannel: async () => ({
        ...acceptedChannel(),
        accepted: () => false,
        bindProcessGroup() {},
        waitForResult: () => new Promise(() => {}),
      }),
      resultService: { prepare() {} },
      run,
      setDeadlineTimer(callback, milliseconds) {
        assert.equal(milliseconds, 15 * 60 * 1_000);
        deadlines.push(callback);
        return {};
      },
      spawnProcess: () => /** @type {any} */ (child),
    });
  }

  const first = runUntilDeadline(81);
  const second = runUntilDeadline(82);
  while (deadlines.length < 2) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  deadlines[0]();
  await assert.rejects(
    () => first,
    (error) =>
      error instanceof ReviewRunExecutionError &&
      error.code === "deadline_exceeded",
  );
  assert.deepEqual(terminated, [81]);
  deadlines[1]();
  await assert.rejects(
    () => second,
    (error) =>
      error instanceof ReviewRunExecutionError &&
      error.code === "deadline_exceeded",
  );
  assert.deepEqual(terminated, [81, 82]);
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
        queueMicrotask(() => child.emit("close", 0, null));
      }
    },
    openSubmissionChannel: async () => acceptedChannel(),
    resultService: { prepare() {} },
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
    resultService: { prepare() {} },
    run,
    setTerminationTimer(callback, milliseconds) {
      assert.equal(milliseconds, 5_000);
      setImmediate(callback);
      return { unref() {} };
    },
    spawnProcess() {
      queueMicrotask(() => child.emit("close", 0, null));
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
      queueMicrotask(() => child.emit("close", 0, null));
      throw Object.assign(new Error("process already exited"), {
        code: "ESRCH",
      });
    },
    openSubmissionChannel: async () => acceptedChannel(),
    resultService: { prepare() {} },
    run,
    spawnProcess: () => /** @type {any} */ (child),
  });
});

test(
  "termination failure surfaces without waiting for process close after an accepted Result",
  { timeout: 1_000 },
  async () => {
    const terminationFailure = Object.assign(new Error("kill not permitted"), {
      code: "EPERM",
    });
    const child = runningProcess(78);
    await assert.rejects(
      () =>
        runReviewRunCodex({
          checkoutPath: "/checkout",
          claim,
          killProcessGroup() {
            throw terminationFailure;
          },
          openSubmissionChannel: async () => acceptedChannel(),
          resultService: { prepare() {} },
          run,
          spawnProcess: () => /** @type {any} */ (child),
        }),
      (error) =>
        error instanceof ReviewRunExecutionError &&
        error.code === "codex_process_failed" &&
        error.cause === terminationFailure,
    );
  },
);

test("permission-denied liveness still attempts the survivor force-kill", async () => {
  /** @type {(string | number)[]} */
  const signals = [];
  const permissionFailure = Object.assign(new Error("kill not permitted"), {
    code: "EPERM",
  });
  const child = runningProcess(79);
  assert.deepEqual(
    await runReviewRunCodex({
      checkoutPath: "/checkout",
      claim,
      clearTerminationTimer() {},
      killProcessGroup(pid, signal) {
        assert.equal(pid, -79);
        signals.push(signal);
        if (signal === "SIGTERM") {
          queueMicrotask(() => child.emit("close", 0, null));
        } else {
          throw permissionFailure;
        }
      },
      openSubmissionChannel: async () => acceptedChannel(),
      resultService: { prepare() {} },
      run,
      setTerminationTimer(callback) {
        setImmediate(callback);
        return {};
      },
      spawnProcess: () => /** @type {any} */ (child),
    }),
    { diagnosticFailures: [permissionFailure] },
  );
  assert.deepEqual(signals, ["SIGTERM", 0, "SIGKILL"]);
});
