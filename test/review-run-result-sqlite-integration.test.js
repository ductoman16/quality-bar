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
import { createReviewService } from "../src/review.js";

test("the first valid fenced submission creates the sole clear Evaluation Result", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-result-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  core.run(
    "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES (?, ?, ?, ?)",
    "repository-1",
    "https://example.invalid/repository.git",
    1,
    1,
  );
  let fact = 0;
  const review = createReviewService(core, {
    createId: () => `result-fact-${++fact}`,
    now: () => 2,
  }).create({
    assignment: { scope: "installation_wide" },
    codex_configuration: {
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      service_tier: "standard",
    },
    criteria: [
      { impact: "blocking", instruction: "First clear Criterion" },
      { impact: "advisory", instruction: "Second clear Criterion" },
    ],
    description: "Clear result proof",
    name: "Clear result proof",
  });
  await createEvaluationService(core, {
    acquireChangeset: async () => ({
      base_commit: "1".repeat(40),
      head_commit: "2".repeat(40),
    }),
    createId: () => "evaluation-1",
    createReviewRunId: () => "review-run-1",
    masterKey: Buffer.alloc(32, 7),
    now: () => 10,
    readCodexCapabilityFailure: () => null,
    storageReserve: { assertWorkAdmissionAvailable() {} },
  }).createExplicit({
    channel: "browser_session",
    idempotencyKey: "clear-result",
    repositoryId: "repository-1",
    request: {
      base: { type: "branch", value: "main" },
      head: { type: "branch", value: "topic" },
    },
  });
  const claims = createReviewRunClaimService(core, {
    createWorkerId: () => "worker-1",
    now: () => 20,
  });
  const claim = claims.claimNext();
  assert.ok(claim);
  claims.start(claim);
  const results = createReviewRunResultService(core, { now: () => 30 });

  assert.throws(
    () =>
      results.submit(claim, {
        criterion_results: [
          {
            criterion_id: review.active_version.criteria[0].id,
            outcome: "clear",
          },
        ],
      }),
    (error) =>
      error instanceof ReviewRunExecutionError &&
      error.code === "criterion_result_coverage_invalid",
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM criterion_results")?.count,
    0,
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM evaluation_results")?.count,
    0,
  );

  results.submit(claim, {
    criterion_results: review.active_version.criteria.map(({ id }) => ({
      criterion_id: id,
      outcome: "clear",
    })),
  });
  assert.deepEqual(
    createEvaluationService(core, {
      acquireChangeset: async () => {
        throw new Error("not used");
      },
      masterKey: Buffer.alloc(32, 7),
      readCodexCapabilityFailure: () => null,
      storageReserve: { assertWorkAdmissionAvailable() {} },
    }).readResult("evaluation-1"),
    {
      applicability_results: [],
      completed_at: "1970-01-01T00:00:00.030Z",
      criterion_results: review.active_version.criteria.map(({ id }) => ({
        criterion_id: id,
        outcome: "clear",
        review_run_id: "review-run-1",
      })),
      evaluation_id: "evaluation-1",
      findings: [],
      outcome: "clear",
      review_runs: [
        {
          completed_at: "1970-01-01T00:00:00.030Z",
          id: "review-run-1",
          review_id: review.id,
          review_version_id: review.active_version.id,
          started_at: "1970-01-01T00:00:00.020Z",
          status: "completed",
        },
      ],
    },
  );
  assert.throws(
    () =>
      results.submit(claim, {
        criterion_results: review.active_version.criteria.map(({ id }) => ({
          criterion_id: id,
          outcome: "clear",
        })),
      }),
    (error) =>
      error instanceof ReviewRunExecutionError &&
      error.code === "submission_channel_closed",
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM criterion_results")?.count,
    2,
  );
});
