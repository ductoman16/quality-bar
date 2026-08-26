import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable/durable-core.ts";
import {
  cancelEvaluationInTransaction,
  SUPERSESSION_CANCELLATION,
} from "../src/evaluation/evaluation-cancellation.ts";
import { createEvaluationService } from "../src/evaluation/evaluation.ts";
import { createReviewRunClaimService } from "../src/review/review-run-claim.ts";
import {
  createReviewRunResultService,
  ReviewRunExecutionError,
} from "../src/review/review-run-result.ts";
import { createQueuedReviewRun } from "./review-run-claim-support.ts";

test("SQLite Analytics derives canonical Result and Review Run reliability facts", async (context) => {
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
  assert.deepEqual(analytics.review_run_reliability, {
    active: 0,
    duration: {
      failed: { execution_count: 1, median_ms: 10, total_ms: 10 },
      operator_cancelled: {
        execution_count: 0,
        median_ms: null,
        total_ms: null,
      },
      successful: { execution_count: 1, median_ms: 10, total_ms: 10 },
      superseded: { execution_count: 0, median_ms: null, total_ms: null },
      terminal: { execution_count: 2, median_ms: 10, total_ms: 20 },
    },
    failed: 1,
    failed_rate: { denominator: 2, numerator: 1 },
    failure_codes: [{ code: "codex_process_failed", count: 1 }],
    operator_cancelled: 0,
    operator_cancelled_rate: { denominator: 2, numerator: 0 },
    successful: 1,
    successful_rate: { denominator: 2, numerator: 1 },
    superseded: 0,
    superseded_rate: { denominator: 2, numerator: 0 },
    token_counters: {
      cached_input_tokens: {
        coverage: { denominator: 2, numerator: 0 },
        median: null,
        sum: null,
      },
      input_tokens: {
        coverage: { denominator: 2, numerator: 0 },
        median: null,
        sum: null,
      },
      output_tokens: {
        coverage: { denominator: 2, numerator: 0 },
        median: null,
        sum: null,
      },
    },
  });
});

test("SQLite Analytics classifies a started superseded Review Run from its canonical Evaluation fact", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-analytics-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  await createQueuedReviewRun(core);

  const claims = createReviewRunClaimService(core, {
    createWorkerId: () => "superseded-analytics-worker",
    now: () => 20,
  });
  const claim = claims.claimNext();
  assert.ok(claim);
  claims.start(claim, "0.145.0");
  core.transaction((transaction) =>
    cancelEvaluationInTransaction(
      transaction,
      "evaluation-1",
      30,
      SUPERSESSION_CANCELLATION,
      (code, detail) => {
        throw new Error(`${code}: ${detail}`);
      },
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
  assert.deepEqual(analytics.review_run_reliability, {
    active: 0,
    duration: {
      failed: { execution_count: 0, median_ms: null, total_ms: null },
      operator_cancelled: {
        execution_count: 0,
        median_ms: null,
        total_ms: null,
      },
      successful: { execution_count: 0, median_ms: null, total_ms: null },
      superseded: { execution_count: 1, median_ms: 10, total_ms: 10 },
      terminal: { execution_count: 1, median_ms: 10, total_ms: 10 },
    },
    failed: 0,
    failed_rate: { denominator: 1, numerator: 0 },
    failure_codes: [],
    operator_cancelled: 0,
    operator_cancelled_rate: { denominator: 1, numerator: 0 },
    successful: 0,
    successful_rate: { denominator: 1, numerator: 0 },
    superseded: 1,
    superseded_rate: { denominator: 1, numerator: 1 },
    token_counters: {
      cached_input_tokens: {
        coverage: { denominator: 1, numerator: 0 },
        median: null,
        sum: null,
      },
      input_tokens: {
        coverage: { denominator: 1, numerator: 0 },
        median: null,
        sum: null,
      },
      output_tokens: {
        coverage: { denominator: 1, numerator: 0 },
        median: null,
        sum: null,
      },
    },
  });
});
