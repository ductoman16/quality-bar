import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { createEvaluationService } from "../src/evaluation.js";
import { createReviewRunClaimService } from "../src/review-run-claim.js";
import {
  createReviewRunResultService,
  ReviewRunExecutionError,
} from "../src/review-run-result.js";
import { createQueuedReviewRun } from "./review-run-claim-support.js";

test("SQLite Analytics derives only canonical Results and excludes a failed Review Run", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-analytics-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  await createQueuedReviewRun(core, { reviewCount: 2 });

  let now = 20;
  let worker = 0;
  const claims = createReviewRunClaimService(core, {
    createWorkerId: () => `analytics-worker-${++worker}`,
    now: () => now,
  });
  const results = createReviewRunResultService(core, { now: () => now });
  const completedClaim = claims.claimNext();
  assert.ok(completedClaim);
  claims.start(completedClaim, "0.145.0");
  const criterion = core.get(
    `SELECT review_version_criteria.criterion_id
       FROM review_runs
       JOIN review_version_criteria
         ON review_version_criteria.review_version_id =
            review_runs.review_version_id
      WHERE review_runs.id = ?`,
    completedClaim.workId,
  );
  if (typeof criterion?.criterion_id !== "string") {
    throw new Error("Canonical Criterion identity is missing");
  }
  now = 30;
  results.prepare(
    completedClaim,
    {
      criterion_results: [
        { criterion_id: criterion.criterion_id, outcome: "clear" },
      ],
    },
    [],
  );

  now = 40;
  const failedClaim = claims.claimNext();
  assert.ok(failedClaim);
  claims.start(failedClaim, "0.145.0");
  now = 50;
  results.fail(
    failedClaim,
    new ReviewRunExecutionError(
      "codex_process_failed",
      "The independent Review Run failed.",
    ),
  );

  const analytics = createEvaluationService(core, {
    acquireChangeset: async () => {
      throw new Error("unused acquisition");
    },
    masterKey: Buffer.alloc(32, 7),
    readCodexCapabilityFailure: () => null,
    storageReserve: { assertWorkAdmissionAvailable() {} },
  }).readAnalytics();
  assert.equal(analytics.review_applicability.length, 2);
  for (const review of analytics.review_applicability) {
    assert.deepEqual(review.applicability_rate, {
      denominator: 1,
      numerator: 1,
    });
  }
  assert.deepEqual(analytics.criterion_outcomes, [
    {
      clear: 1,
      clear_rate: { denominator: 1, numerator: 1 },
      criterion_id: criterion.criterion_id,
      error: 0,
      error_rate: { denominator: 1, numerator: 0 },
      not_applicable: 0,
      not_applicable_rate: { denominator: 1, numerator: 0 },
      trigger_rate: { denominator: 1, numerator: 0 },
      triggered: 0,
    },
  ]);
});
