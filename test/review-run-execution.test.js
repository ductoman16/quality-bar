import assert from "node:assert/strict";
import { test } from "node:test";

import { executeReviewRun } from "../src/review-run-execution.js";
import { ReviewRunCheckoutError } from "../src/review-run-checkout.js";

const claim = Object.freeze({
  fencingToken: 7,
  workerId: "worker-1",
  workId: "run-1",
});

function durableCore() {
  return {
    all() {
      return [
        {
          criterion_id: "criterion-1",
          impact: "blocking",
          instruction: "Reject broken changes",
        },
      ];
    },
    /** @param {string} sql */
    get(sql) {
      assert.match(sql, /FROM review_runs/);
      return {
        applicability_rule: null,
        base_commit: "a".repeat(40),
        execution_status: "queued",
        head_commit: "b".repeat(40),
        model: "gpt-5.3-codex",
        name: "Correctness",
        normalized_url: "https://example.test/repository.git",
        reasoning_effort: "high",
        service_tier: "priority",
      };
    },
  };
}

test("prepares checkout before starting the Review Run timer", async () => {
  /** @type {string[]} */
  const events = [];
  await executeReviewRun(durableCore(), claim, {
    claimService: {
      start() {
        events.push("start");
      },
      startRenewal() {
        return () => events.push("stop-renewal");
      },
    },
    async prepareCheckout() {
      events.push("checkout");
      return {
        path: "/checkout",
        remove() {
          events.push("remove-checkout");
        },
      };
    },
    resultService: { submit() {} },
    async runCodex() {
      events.push("codex");
    },
  });

  assert.deepEqual(events, [
    "checkout",
    "start",
    "codex",
    "remove-checkout",
    "stop-renewal",
  ]);
});

test("checkout failure remains pre-start and does not launch Codex", async () => {
  const failure = new ReviewRunCheckoutError(
    "review_run_checkout_failed",
    "Review Run checkout preparation failed",
  );
  let started = false;
  let launched = false;
  await assert.rejects(
    () =>
      executeReviewRun(durableCore(), claim, {
        claimService: {
          start() {
            started = true;
          },
          startRenewal() {
            return () => {};
          },
        },
        async prepareCheckout() {
          throw failure;
        },
        resultService: { submit() {} },
        async runCodex() {
          launched = true;
        },
      }),
    (error) => error === failure,
  );
  assert.equal(started, false);
  assert.equal(launched, false);
});
