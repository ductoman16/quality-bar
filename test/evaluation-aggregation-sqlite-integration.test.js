import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable/durable-core.js";
import { createEvaluationService } from "../src/evaluation/evaluation.js";
import { createReviewRunClaimService } from "../src/review/review-run-claim.js";
import { createReviewRunEvidenceService } from "../src/review/review-run-evidence.js";
import {
  createReviewRunResultService,
  ReviewRunExecutionError,
} from "../src/review/review-run-result.js";
import { createReviewService } from "../src/review/review.js";

test("independent sibling Review Runs publish one Result only after every run is terminal", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-aggregate-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  core.run(
    "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES (?, ?, ?, ?)",
    "repository-aggregate",
    "https://example.invalid/aggregate.git",
    1,
    1,
  );
  let fact = 0;
  const reviews = createReviewService(core, {
    createId: () => `aggregate-fact-${++fact}`,
    now: () => fact,
  });
  const blockingReview = reviews.create({
    assignment: { scope: "installation_wide" },
    codex_configuration: {
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      service_tier: "standard",
    },
    criteria: [{ impact: "blocking", instruction: "Find the blocker." }],
    description: "Independent blocking Review",
    name: "Blocking Review",
  });
  const failingReview = reviews.create({
    assignment: { scope: "installation_wide" },
    codex_configuration: {
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      service_tier: "standard",
    },
    criteria: [{ impact: "advisory", instruction: "Find the advisory." }],
    description: "Independent failing Review",
    name: "Failing Review",
  });
  const reviewRunIds = ["review-run-blocking", "review-run-failed"];
  await createEvaluationService(core, {
    acquireChangeset: async () => ({
      base_commit: "1".repeat(40),
      head_commit: "2".repeat(40),
    }),
    createId: () => "evaluation-aggregate",
    createReviewRunId: () => /** @type {string} */ (reviewRunIds.shift()),
    masterKey: Buffer.alloc(32, 7),
    now: () => 10,
    readCodexCapabilityFailure: () => null,
    storageReserve: { assertWorkAdmissionAvailable() {} },
  }).createExplicit({
    channel: "browser_session",
    idempotencyKey: "aggregate",
    repositoryId: "repository-aggregate",
    request: {
      base: { type: "branch", value: "main" },
      head: { type: "branch", value: "topic" },
    },
  });

  let observedAt = 20;
  let worker = 0;
  const claims = createReviewRunClaimService(core, {
    createWorkerId: () => `worker-${++worker}`,
    now: () => observedAt,
  });
  const results = createReviewRunResultService(core, {
    createFindingId: () => "finding-blocking",
    now: () => observedAt,
  });
  const evidence = createReviewRunEvidenceService(core);
  const frozenFileChanges = [
    {
      added: false,
      after_path: "after.txt",
      base_line_count: 1,
      before_path: "before.txt",
      deleted: false,
      head_line_count: 1,
      id: "file-change-1",
      modified: false,
      patch: "",
      renamed: true,
    },
  ];
  const firstClaim = claims.claimNext();
  assert.ok(firstClaim);
  claims.start(firstClaim, "0.145.0");
  observedAt = 30;
  results.prepare(
    firstClaim,
    {
      criterion_results: [
        {
          criterion_id: blockingReview.active_version.criteria[0].id,
          findings: [
            {
              evidence: "The completed sibling found a blocking concern.",
              location: { kind: "changeset" },
              remediation: "Resolve the blocking concern.",
            },
          ],
          outcome: "triggered",
        },
      ],
    },
    frozenFileChanges,
  );
  evidence.complete(firstClaim, {
    exitCode: 0,
    signal: null,
    tokenCounters: {
      cached_input_tokens: null,
      input_tokens: null,
      output_tokens: null,
    },
  });
  assert.equal(
    core.get(
      "SELECT count(*) AS count FROM evaluation_results WHERE evaluation_id = ?",
      "evaluation-aggregate",
    )?.count,
    0,
  );
  assert.equal(
    core.get(
      "SELECT execution_status FROM evaluations WHERE id = ?",
      "evaluation-aggregate",
    )?.execution_status,
    "queued",
  );

  observedAt = 40;
  const secondClaim = claims.claimNext();
  assert.ok(secondClaim);
  claims.start(secondClaim, "0.145.0");
  observedAt = 50;
  assert.throws(
    () =>
      results.prepare(
        secondClaim,
        {
          criterion_results: [
            {
              criterion_id: failingReview.active_version.criteria[0].id,
              outcome: "clear",
            },
          ],
        },
        [
          {
            ...frozenFileChanges[0],
            head_line_count: 1,
            modified: true,
          },
        ],
      ),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "evaluation_file_change_authority_mismatch" &&
      error.message ===
        "Frozen File Changes do not match the Evaluation authority",
  );
  assert.equal(
    core.get(
      "SELECT count(*) AS count FROM evaluation_results WHERE evaluation_id = ?",
      "evaluation-aggregate",
    )?.count,
    0,
  );
  evidence.complete(secondClaim, {
    exitCode: 1,
    signal: null,
    tokenCounters: {
      cached_input_tokens: null,
      input_tokens: null,
      output_tokens: null,
    },
  });
  results.fail(
    secondClaim,
    new ReviewRunExecutionError(
      "configuration_unavailable",
      "The failing Review owns this exact configuration error.",
    ),
  );

  const result = createEvaluationService(core, {
    acquireChangeset: async () => {
      throw new Error("not used");
    },
    masterKey: Buffer.alloc(32, 7),
    readCodexCapabilityFailure: () => null,
    storageReserve: { assertWorkAdmissionAvailable() {} },
  }).readResult("evaluation-aggregate");
  assert.equal(result.outcome, "error");
  assert.equal(result.completed_at, "1970-01-01T00:00:00.050Z");
  assert.deepEqual(
    result.review_runs.map((run) => ({
      error: run.error,
      id: run.id,
      status: run.execution_status,
    })),
    [
      {
        error: undefined,
        id: "review-run-blocking",
        status: "completed",
      },
      {
        error: {
          code: "configuration_unavailable",
          detail: "The failing Review owns this exact configuration error.",
        },
        id: "review-run-failed",
        status: "failed",
      },
    ],
  );
  assert.deepEqual(result.criterion_results, [
    {
      criterion_id: blockingReview.active_version.criteria[0].id,
      outcome: "triggered",
      review_run_id: "review-run-blocking",
    },
  ]);
  assert.equal(
    result.criterion_results.some(
      ({ criterion_id: criterionId }) =>
        criterionId === failingReview.active_version.criteria[0].id,
    ),
    false,
  );
  assert.deepEqual(result.findings, [
    {
      criterion_id: blockingReview.active_version.criteria[0].id,
      evidence: "The completed sibling found a blocking concern.",
      id: "finding-blocking",
      impact: "blocking",
      location: { kind: "changeset" },
      remediation: "Resolve the blocking concern.",
      review_run_id: "review-run-blocking",
    },
  ]);
  assert.deepEqual(
    core.get(
      "SELECT execution_status, completed_at FROM evaluations WHERE id = ?",
      "evaluation-aggregate",
    ),
    { completed_at: 50, execution_status: "completed" },
  );
});
