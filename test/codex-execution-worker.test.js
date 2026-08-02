import assert from "node:assert/strict";
import test from "node:test";

import { createCodexExecutionWorker } from "../src/codex-execution-worker.js";
import { createStorageGuardedClaimService } from "../src/codex-execution-runtime.js";

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
  let closed = false;
  const closing = worker.close().then(() => {
    closed = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closed, false);
  const reviewRelease = releases.shift();
  assert.ok(reviewRelease);
  reviewRelease();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closed, false);
  const waiverRelease = releases.shift();
  assert.ok(waiverRelease);
  waiverRelease();
  await closing;
  assert.equal(closed, true);
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

test("the production start boundary checks storage before authoritative Codex start", () => {
  const failure = Object.assign(new Error("storage low exactly"), {
    code: "storage_reserve_unavailable",
  });
  let started = false;
  const service = createStorageGuardedClaimService(
    {
      start() {
        started = true;
      },
      startTracked() {
        started = true;
      },
    },
    {
      assertCodexStartAvailable() {
        throw failure;
      },
    },
  );
  assert.throws(
    () => service.startTracked({}, "0.145.0", 4321),
    (error) => error === failure,
  );
  assert.equal(started, false);
});
