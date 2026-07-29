import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { createEvaluationService } from "../src/evaluation.js";
import { executeReviewRun } from "../src/review-run-execution.js";
import { createReviewRunClaimService } from "../src/review-run-claim.js";
import {
  createReviewRunResultService,
  ReviewRunExecutionError,
} from "../src/review-run-result.js";
import { createReviewService } from "../src/review.js";
import { createQueuedReviewRun } from "./review-run-claim-support.js";

test("the first valid fenced submission atomically creates triggered Findings with inherited impact", async (context) => {
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
  let finding = 0;
  const results = createReviewRunResultService(core, {
    createFindingId: () => `finding-${++finding}`,
    now: () => 30,
  });
  const fileChanges = [
    {
      after_path: "src/current.js",
      base_line_count: 2,
      before_path: "src/previous.js",
      head_line_count: 3,
      id: "file-change-1",
    },
  ];

  assert.throws(
    () =>
      results.submit(
        claim,
        {
          criterion_results: [
            {
              criterion_id: review.active_version.criteria[0].id,
              findings: [
                {
                  evidence: "The submitted range invents a head line.",
                  location: {
                    end_line: 4,
                    file_change_id: "file-change-1",
                    kind: "line_range",
                    side: "head",
                    start_line: 4,
                  },
                  remediation: "Use an inclusive range within the frozen side.",
                },
              ],
              outcome: "triggered",
            },
            {
              criterion_id: review.active_version.criteria[1].id,
              outcome: "clear",
            },
          ],
        },
        fileChanges,
      ),
    (error) =>
      error instanceof ReviewRunExecutionError &&
      error.code === "finding_location_line_range_invalid",
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM criterion_results")?.count,
    0,
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM evaluation_results")?.count,
    0,
  );
  assert.equal(core.get("SELECT count(*) AS count FROM findings")?.count, 0);
  assert.equal(
    core.get("SELECT count(*) AS count FROM evaluation_file_changes")?.count,
    0,
  );

  results.submit(
    claim,
    {
      criterion_results: [
        {
          criterion_id: review.active_version.criteria[0].id,
          findings: [
            {
              evidence: "The changed branch returns stale state.",
              location: {
                end_line: 3,
                file_change_id: "file-change-1",
                kind: "line_range",
                side: "head",
                start_line: 2,
              },
              remediation: "Return the newly computed state.",
            },
          ],
          outcome: "triggered",
        },
        {
          criterion_id: review.active_version.criteria[1].id,
          outcome: "clear",
        },
      ],
    },
    fileChanges,
  );
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
      criterion_results: [
        {
          criterion_id: review.active_version.criteria[0].id,
          outcome: "triggered",
          review_run_id: "review-run-1",
        },
        {
          criterion_id: review.active_version.criteria[1].id,
          outcome: "clear",
          review_run_id: "review-run-1",
        },
      ],
      evaluation_id: "evaluation-1",
      findings: [
        {
          criterion_id: review.active_version.criteria[0].id,
          evidence: "The changed branch returns stale state.",
          id: "finding-1",
          impact: "blocking",
          location: {
            end_line: 3,
            file_change_id: "file-change-1",
            kind: "line_range",
            path: "src/current.js",
            side: "head",
            start_line: 2,
          },
          remediation: "Return the newly computed state.",
          review_run_id: "review-run-1",
        },
      ],
      outcome: "blocking",
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
      results.submit(
        claim,
        {
          criterion_results: review.active_version.criteria.map(({ id }) => ({
            criterion_id: id,
            outcome: "clear",
          })),
        },
        fileChanges,
      ),
    (error) =>
      error instanceof ReviewRunExecutionError &&
      error.code === "submission_channel_closed",
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM criterion_results")?.count,
    2,
  );
});

test("an exact Review Run boundary failure creates no partial or fallback Result", async (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-boundary-failure-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  await createQueuedReviewRun(core);
  const claims = createReviewRunClaimService(core, {
    createWorkerId: () => "boundary-worker",
    now: () => 20,
  });
  const claim = claims.claimNext();
  assert.ok(claim);
  const failure = new ReviewRunExecutionError(
    "configuration_unavailable",
    "Network-disabled Codex launch could not be constructed",
  );

  await assert.rejects(
    () =>
      executeReviewRun(core, claim, {
        claimService: claims,
        prepareCheckout: async () => ({
          path: "/discarded-checkout",
          remove() {},
        }),
        readFileChanges: () => [],
        resultService: createReviewRunResultService(core, { now: () => 30 }),
        async runCodex() {
          throw failure;
        },
      }),
    (error) => error === failure,
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM evaluation_results")?.count,
    0,
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM criterion_results")?.count,
    0,
  );
});
