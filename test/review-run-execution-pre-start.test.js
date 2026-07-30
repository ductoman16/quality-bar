import assert from "node:assert/strict";
import { test } from "node:test";

import { createIoExecutionPool } from "../src/io-execution-pool.js";
import { ReviewRunCheckoutError } from "../src/review-run-checkout.js";
import { executeReviewRun } from "../src/review-run-execution.js";

const claim = Object.freeze({
  fencingToken: 7,
  workerId: "worker-1",
  workId: "run-1",
});

const durableCore = {
  all: () => [
    {
      criterion_id: "criterion-1",
      impact: "blocking",
      instruction: "Reject broken changes",
    },
  ],
  get: () => ({
    applicability_rule: null,
    base_commit: "a".repeat(40),
    execution_status: "queued",
    head_commit: "b".repeat(40),
    model: "gpt-5.3-codex",
    name: "Correctness",
    normalized_url: "https://example.test/repository.git",
    reasoning_effort: "high",
    service_tier: "priority",
  }),
};

test("checkout failure records the accepted pre-start attempt without launching Codex", async () => {
  const failure = new ReviewRunCheckoutError(
    "review_run_checkout_failed",
    "Review Run checkout preparation failed",
  );
  let started = false;
  let launched = false;
  let recordedFailure;
  await assert.rejects(
    () =>
      executeReviewRun(durableCore, claim, {
        ioPool: createIoExecutionPool(),
        claimService: {
          beginPreStartAttempt() {},
          recordPreStartFailure(claimArgument, recorded) {
            assert.equal(claimArgument, claim);
            recordedFailure = recorded;
          },
          release() {},
          startTracked() {
            started = true;
          },
          startRenewal() {
            return () => {};
          },
        },
        async prepareCheckout() {
          throw failure;
        },
        readFileChanges: () => [],
        resultService: { fail() {}, prepare() {} },
        async runCodex() {
          launched = true;
          return { diagnosticFailures: [] };
        },
      }),
    (error) => error === failure,
  );
  assert.equal(started, false);
  assert.equal(launched, false);
  assert.equal(recordedFailure, failure);
});

test("a rejected acquisition before callback entry releases without consuming an attempt", async () => {
  const failure = new Error("Durable storage is unavailable");
  let callbackEntered = false;
  let released = false;
  await assert.rejects(
    () =>
      executeReviewRun(durableCore, claim, {
        ioPool: {
          run(...parameters) {
            const operation = parameters[1];
            assert.equal(typeof operation, "function");
            return Promise.reject(failure);
          },
        },
        claimService: {
          beginPreStartAttempt() {
            callbackEntered = true;
          },
          recordPreStartFailure() {
            assert.fail("an unentered acquisition must not consume an attempt");
          },
          release(claimArgument) {
            assert.equal(claimArgument, claim);
            released = true;
          },
          startTracked() {},
          startRenewal() {
            return () => {};
          },
        },
        readFileChanges: () => [],
        resultService: { fail() {}, prepare() {} },
      }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "unexpected_execution_failure",
  );
  assert.equal(callbackEntered, false);
  assert.equal(released, true);
});
