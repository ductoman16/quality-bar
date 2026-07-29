import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import {
  signalReviewRunCancellations,
  subscribeReviewRunCancellation,
} from "../src/evaluation-cancellation.js";
import { createEvaluationService } from "../src/evaluation.js";
import { createReviewRunClaimService } from "../src/review-run-claim.js";
import {
  createReviewRunResultService,
  ReviewRunExecutionError,
} from "../src/review-run-result.js";
import { createReviewService } from "../src/review.js";

test("durable cancellation wins before signaling and preserves completed child facts", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-cancellation-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  core.run(
    "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES (?, ?, ?, ?)",
    "repository-cancellation",
    "https://example.invalid/cancellation.git",
    1,
    1,
  );
  let fact = 0;
  const reviews = createReviewService(core, {
    createId: () => `cancellation-fact-${++fact}`,
    now: () => fact,
  });
  const createdReviews = ["completed", "running", "queued"].map((name) =>
    reviews.create({
      assignment: { scope: "installation_wide" },
      codex_configuration: {
        model: "gpt-5.6-terra",
        reasoning_effort: "high",
        service_tier: "standard",
      },
      criteria: [{ impact: "blocking", instruction: `Prove ${name}.` }],
      description: `${name} cancellation proof`,
      name: `${name} cancellation proof`,
    }),
  );
  let observedAt = 10;
  const runIds = [
    "review-run-1-completed",
    "review-run-2-running",
    "review-run-3-queued",
  ];
  const evaluations = createEvaluationService(core, {
    acquireChangeset: async () => ({
      base_commit: "1".repeat(40),
      head_commit: "2".repeat(40),
    }),
    createId: () => "evaluation-cancellation",
    createReviewRunId: () => /** @type {string} */ (runIds.shift()),
    masterKey: Buffer.alloc(32, 7),
    now: () => observedAt,
    readCodexCapabilityFailure: () => null,
    signalCancellations: signalReviewRunCancellations,
    storageReserve: { assertWorkAdmissionAvailable() {} },
  });
  await evaluations.createExplicit({
    channel: "browser_session",
    idempotencyKey: "cancellation",
    repositoryId: "repository-cancellation",
    request: {
      base: { type: "branch", value: "main" },
      head: { type: "branch", value: "topic" },
    },
  });
  let worker = 0;
  const claims = createReviewRunClaimService(core, {
    createWorkerId: () => `worker-${++worker}`,
    now: () => observedAt,
  });
  const results = createReviewRunResultService(core, {
    now: () => observedAt,
  });
  const completedClaim = claims.claimNext();
  assert.ok(completedClaim);
  claims.start(completedClaim, "0.145.0");
  observedAt = 20;
  results.prepare(
    completedClaim,
    {
      criterion_results: [
        {
          criterion_id: createdReviews[0].active_version.criteria[0].id,
          outcome: "clear",
        },
      ],
    },
    [],
  );
  observedAt = 30;
  const runningClaim = claims.claimNext();
  assert.ok(runningClaim);
  claims.start(runningClaim, "0.145.0");
  let signalObservedState;
  const unsubscribe = subscribeReviewRunCancellation(
    runningClaim.workId,
    () => {
      signalObservedState = core.get(
        `SELECT execution_status, cancellation_requested_at
         FROM evaluations WHERE id = 'evaluation-cancellation'`,
      );
    },
  );
  context.after(unsubscribe);

  observedAt = 40;
  const cancelled = evaluations.cancel("evaluation-cancellation");
  assert.deepEqual(signalObservedState, {
    cancellation_requested_at: 40,
    execution_status: "cancelled",
  });
  assert.equal(cancelled.execution_status, "cancelled");
  assert.equal(cancelled.effective_outcome, "error");
  assert.deepEqual(
    core.all(
      `SELECT id, execution_status, started_at, completed_at
       FROM review_runs ORDER BY id`,
    ),
    [
      {
        completed_at: 20,
        execution_status: "completed",
        id: "review-run-1-completed",
        started_at: 10,
      },
      {
        completed_at: 40,
        execution_status: "cancelled",
        id: "review-run-2-running",
        started_at: 30,
      },
      {
        completed_at: null,
        execution_status: "cancelled",
        id: "review-run-3-queued",
        started_at: null,
      },
    ],
  );
  assert.equal(
    core.get(
      `SELECT count(*) AS count FROM codex_execution_queue
       WHERE work_id = 'review-run-3-queued'`,
    )?.count,
    0,
  );
  assert.throws(
    () =>
      results.prepare(
        runningClaim,
        {
          criterion_results: [
            {
              criterion_id: createdReviews[1].active_version.criteria[0].id,
              outcome: "clear",
            },
          ],
        },
        [],
      ),
    (error) =>
      error instanceof ReviewRunExecutionError &&
      error.code === "submission_channel_closed",
  );

  const result = evaluations.readResult("evaluation-cancellation");
  assert.equal(result.outcome, "error");
  assert.equal(result.completed_at, "1970-01-01T00:00:00.040Z");
  assert.deepEqual(
    result.review_runs.map((run) => ({
      error: run.error,
      id: run.id,
      status: run.status,
    })),
    [
      {
        error: undefined,
        id: "review-run-1-completed",
        status: "completed",
      },
      {
        error: {
          code: "cancelled_by_operator",
          detail: "Evaluation was cancelled by the operator",
        },
        id: "review-run-2-running",
        status: "cancelled",
      },
      {
        error: {
          code: "cancelled_by_operator",
          detail: "Evaluation was cancelled by the operator",
        },
        id: "review-run-3-queued",
        status: "cancelled",
      },
    ],
  );
  assert.deepEqual(result.criterion_results, [
    {
      criterion_id: createdReviews[0].active_version.criteria[0].id,
      outcome: "clear",
      review_run_id: "review-run-1-completed",
    },
  ]);
  assert.deepEqual(result.findings, []);
  assert.throws(
    () =>
      core.run(
        `UPDATE evaluations
         SET cancellation_detail = ?
         WHERE id = 'evaluation-cancellation'`,
        "rewritten cancellation detail",
      ),
    /evaluation_cancellation_immutable/,
  );
  assert.deepEqual(evaluations.readResult("evaluation-cancellation"), result);
});

test("accepted submission wins when its durable transaction commits before cancellation", async (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-cancellation-win-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  // A zero-Review Evaluation completes atomically at admission.
  core.run(
    "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES (?, ?, ?, ?)",
    "repository-completed",
    "https://example.invalid/completed.git",
    1,
    1,
  );
  const evaluations = createEvaluationService(core, {
    acquireChangeset: async () => ({
      base_commit: "3".repeat(40),
      head_commit: "4".repeat(40),
    }),
    createId: () => "evaluation-completed",
    masterKey: Buffer.alloc(32, 7),
    now: () => 10,
    readCodexCapabilityFailure: () => null,
    signalCancellations: signalReviewRunCancellations,
    storageReserve: { assertWorkAdmissionAvailable() {} },
  });
  await evaluations.createExplicit({
    channel: "browser_session",
    idempotencyKey: "completed",
    repositoryId: "repository-completed",
    request: {
      base: { type: "branch", value: "main" },
      head: { type: "branch", value: "topic" },
    },
  });
  assert.throws(
    () => evaluations.cancel("evaluation-completed"),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "evaluation_not_cancellable",
  );
  assert.equal(evaluations.readResult("evaluation-completed").outcome, "clear");
});
