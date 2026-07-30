import assert from "node:assert/strict";
import test from "node:test";

import { createCodexExecutionWorker } from "../src/codex-execution-worker.js";

test("the application worker fills durable claims without serializing long executions", async () => {
  /** @type {import("../src/codex-execution-claim.js").CodexExecutionClaim[]} */
  const claims = [
    {
      fencingToken: 1,
      leaseExpiresAt: 120_000,
      workerId: "worker-1",
      workId: "review-run-1",
      workKind: "review_run",
    },
    {
      fencingToken: 1,
      leaseExpiresAt: 120_000,
      workerId: "worker-2",
      workId: "waiver-1",
      workKind: "waiver_adjudication",
    },
  ];
  /** @type {(() => void)[]} */
  const timers = [];
  /** @type {((value?: void) => void)[]} */
  const releases = [];
  /** @type {string[]} */
  const started = [];
  const worker = createCodexExecutionWorker({
    claimService: {
      claimNext: () => claims.shift(),
    },
    executeClaim(claim) {
      started.push(claim.workId);
      return new Promise((resolve) => releases.push(resolve));
    },
    reportFailure: assert.fail,
    setTimer(callback) {
      timers.push(callback);
      return { unref() {} };
    },
  });

  worker.start();
  timers.shift()?.();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, ["review-run-1", "waiver-1"]);
  releases.splice(0).forEach((release) => release());
  await worker.close();
});

test("the application worker surfaces the exact claim owner failure", async () => {
  const failure = Object.assign(new Error("claim failed exactly"), {
    code: "codex_claim_failed",
  });
  /** @type {unknown[]} */
  const failures = [];
  /** @type {(() => void)[]} */
  const timers = [];
  const worker = createCodexExecutionWorker({
    claimService: {
      claimNext() {
        throw failure;
      },
    },
    executeClaim: () => assert.fail("execution must not start"),
    reportFailure: (error) => failures.push(error),
    setTimer(callback) {
      timers.push(callback);
      return {};
    },
  });
  worker.start();
  timers.shift()?.();
  assert.deepEqual(failures, [failure]);
  await worker.close();
});
