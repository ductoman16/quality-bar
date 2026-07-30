import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createReviewRunClaimService,
  REVIEW_RUN_LEASE_MILLISECONDS,
  REVIEW_RUN_RENEWAL_MILLISECONDS,
} from "../src/review-run-claim.js";

test("Review Run claims renew every 30 seconds and expire after two minutes", () => {
  assert.equal(REVIEW_RUN_RENEWAL_MILLISECONDS, 30_000);
  assert.equal(REVIEW_RUN_LEASE_MILLISECONDS, 120_000);
});

test("an active Review Run claim schedules renewal every 30 seconds and reports lease loss", () => {
  let intervalCallback = () => {};
  let scheduledMilliseconds;
  let cancelledTimer;
  let updateChanges = 1;
  let now = 30_000;
  const service = createReviewRunClaimService(
    {
      transaction(callback) {
        return callback({
          get() {
            return undefined;
          },
          run() {
            return { changes: updateChanges, lastInsertRowid: 0 };
          },
        });
      },
    },
    {
      clearInterval: (timer) => {
        cancelledTimer = timer;
      },
      createWorkerId: () => "unused-worker",
      now: () => now,
      setInterval: (callback, milliseconds) => {
        intervalCallback = callback;
        scheduledMilliseconds = milliseconds;
        return "renewal-timer";
      },
    },
  );
  const claim = {
    fencingToken: 1,
    leaseExpiresAt: 120_000,
    workerId: "worker-1",
    workId: "review-run-1",
    workKind: /** @type {const} */ ("review_run"),
  };
  /** @type {{code?: string}[]} */
  const losses = [];
  const stop = service.startRenewal(claim, (error) => {
    losses.push(/** @type {{code?: string}} */ (error));
  });
  assert.equal(scheduledMilliseconds, 30_000);
  intervalCallback();
  assert.equal(losses.length, 0);

  now = 60_000;
  updateChanges = 0;
  intervalCallback();
  assert.equal(cancelledTimer, "renewal-timer");
  assert.deepEqual(
    losses.map((loss) => loss.code),
    ["review_run_claim_lost"],
  );
  stop();
});
