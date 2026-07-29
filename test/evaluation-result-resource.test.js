import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { createEvaluationService } from "../src/evaluation.js";
import { createEvaluationResultResourceReader } from "../src/evaluation-result-resource.js";
import { createReviewRunClaimService } from "../src/review-run-claim.js";
import {
  createReviewRunEvidenceService,
  readReviewRunDiagnostics,
} from "../src/review-run-evidence.js";
import {
  createReviewRunResultService,
  ReviewRunExecutionError,
} from "../src/review-run-result.js";
import { createQueuedReviewRun } from "./review-run-claim-support.js";

test("Review Runs are complete canonical resources throughout their lifecycle", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-result-resource-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  await createQueuedReviewRun(core, { reviewCount: 2 });

  const reader = createEvaluationResultResourceReader(core);
  const evaluations = createEvaluationService(core, {
    acquireChangeset: async () => {
      throw new Error("not used");
    },
    masterKey: Buffer.alloc(32, 7),
    readCodexCapabilityFailure: () => null,
    storageReserve: { assertWorkAdmissionAvailable() {} },
  });
  let worker = 0;
  const claims = createReviewRunClaimService(core, {
    createWorkerId: () => `resource-worker-${++worker}`,
    now: () => 20,
  });
  const queued = reader.readReviewRun("evaluation-1", "review-run-1");
  assert.deepEqual(queued, {
    completed_at: null,
    created_at: "1970-01-01T00:00:00.010Z",
    criterion_results: [],
    evaluation_id: "evaluation-1",
    execution_status: "queued",
    findings: [],
    id: "review-run-1",
    measurements: {
      codex_cli_version: null,
      duration_ms: null,
      process: { kind: "unavailable" },
      token_counters: {
        cached_input_tokens: null,
        input_tokens: null,
        output_tokens: null,
      },
    },
    review_id: queued.review_id,
    review_version_id: queued.review_version_id,
    started_at: null,
  });

  const firstClaim = claims.claimNext();
  assert.ok(firstClaim);
  claims.start(firstClaim, "0.145.0");
  assert.equal(
    reader.readReviewRun("evaluation-1", firstClaim.workId).execution_status,
    "running",
  );
  const criterionId = /** @type {{criterion_id: string}} */ (
    core.get(
      `SELECT criterion_id
       FROM review_version_criteria
       JOIN review_runs USING (review_version_id)
       WHERE review_runs.id = ?`,
      firstClaim.workId,
    )
  ).criterion_id;
  createReviewRunResultService(core, {
    createFindingId: () => "finding-1",
    now: () => 30,
  }).prepare(
    firstClaim,
    {
      criterion_results: [
        {
          criterion_id: criterionId,
          findings: [
            {
              evidence: "The immutable evidence.",
              location: { kind: "changeset" },
              remediation: "Correct the exact behavior.",
            },
          ],
          outcome: "triggered",
        },
      ],
    },
    [],
  );
  assert.throws(
    () => reader.readResult("evaluation-1"),
    (error) =>
      /** @type {{code?: string}} */ (error).code ===
      "evaluation_result_not_ready",
  );
  assert.deepEqual(
    (({ completed_at, effective_outcome, execution_status }) => ({
      completed_at,
      effective_outcome,
      execution_status,
    }))(evaluations.read("evaluation-1")),
    {
      completed_at: null,
      effective_outcome: "pending",
      execution_status: "queued",
    },
  );
  assert.deepEqual(
    (({ completed_at, criterion_results, execution_status, findings }) => ({
      completed_at,
      criterion_results,
      execution_status,
      findings,
    }))(reader.readReviewRun("evaluation-1", firstClaim.workId)),
    {
      completed_at: "1970-01-01T00:00:00.030Z",
      criterion_results: [
        {
          criterion_id: criterionId,
          outcome: "triggered",
          review_run_id: firstClaim.workId,
        },
      ],
      execution_status: "completed",
      findings: [reader.readFinding("evaluation-1", "finding-1")],
    },
  );
  const evidence = createReviewRunEvidenceService(core);
  evidence.appendTranscriptChunk(
    firstClaim,
    "stdout",
    '{"type":"turn.completed"}\n',
  );
  evidence.complete(firstClaim, {
    exitCode: 0,
    signal: null,
    tokenCounters: {
      cached_input_tokens: 3,
      input_tokens: 11,
      output_tokens: 5,
    },
  });

  const completedSibling = reader.readReviewRun(
    "evaluation-1",
    firstClaim.workId,
  );
  assert.equal(completedSibling.execution_status, "completed");
  assert.equal(completedSibling.measurements.codex_cli_version, "0.145.0");
  assert.deepEqual(completedSibling.measurements.process, {
    kind: "unavailable",
  });
  assert.deepEqual(completedSibling.measurements.token_counters, {
    cached_input_tokens: null,
    input_tokens: null,
    output_tokens: null,
  });
  assert.equal("transcript_chunks" in completedSibling.measurements, false);
  assert.deepEqual(
    readReviewRunDiagnostics(core, "evaluation-1", firstClaim.workId)?.process,
    {
      code: 0,
      kind: "exit",
    },
  );
  assert.deepEqual(completedSibling.criterion_results, [
    {
      criterion_id: criterionId,
      outcome: "triggered",
      review_run_id: firstClaim.workId,
    },
  ]);
  assert.deepEqual(completedSibling.findings, [
    reader.readFinding("evaluation-1", "finding-1"),
  ]);

  const secondClaim = claims.claimNext();
  assert.ok(secondClaim);
  claims.start(secondClaim, "0.145.0");
  const secondCriterionId = /** @type {{criterion_id: string}} */ (
    core.get(
      `SELECT criterion_id
       FROM review_version_criteria
       JOIN review_runs USING (review_version_id)
       WHERE review_runs.id = ?`,
      secondClaim.workId,
    )
  ).criterion_id;
  createReviewRunResultService(core, { now: () => 40 }).prepare(
    secondClaim,
    {
      criterion_results: [
        {
          criterion_id: secondCriterionId,
          outcome: "clear",
        },
      ],
    },
    [],
  );

  const result = reader.readResult("evaluation-1");
  assert.deepEqual(
    (({ completed_at, effective_outcome, execution_status }) => ({
      completed_at,
      effective_outcome,
      execution_status,
    }))(evaluations.read("evaluation-1")),
    {
      completed_at: "1970-01-01T00:00:00.040Z",
      effective_outcome: "blocking",
      execution_status: "completed",
    },
  );
  assert.deepEqual(
    result.review_runs.find(({ id }) => id === firstClaim.workId),
    completedSibling,
  );
  const secondSibling = result.review_runs.find(
    ({ id }) => id === secondClaim.workId,
  );
  assert.ok(secondSibling);
  assert.deepEqual(
    (({ execution_status, measurements }) => ({
      execution_status,
      measurements,
    }))(secondSibling),
    {
      execution_status: "completed",
      measurements: {
        codex_cli_version: "0.145.0",
        duration_ms: 20,
        process: { kind: "unavailable" },
        token_counters: {
          cached_input_tokens: null,
          input_tokens: null,
          output_tokens: null,
        },
      },
    },
  );
  const directSecondSibling = reader.readReviewRun(
    "evaluation-1",
    secondClaim.workId,
  );
  assert.deepEqual(secondSibling, directSecondSibling);
  evidence.complete(secondClaim, {
    exitCode: 0,
    signal: null,
    tokenCounters: {
      cached_input_tokens: 2,
      input_tokens: 7,
      output_tokens: 3,
    },
  });
  assert.deepEqual(reader.readResult("evaluation-1"), result);
  assert.deepEqual(
    reader.readReviewRun("evaluation-1", secondClaim.workId),
    directSecondSibling,
  );
  assert.deepEqual(
    readReviewRunDiagnostics(core, "evaluation-1", secondClaim.workId)
      ?.token_counters,
    {
      cached_input_tokens: 2,
      input_tokens: 7,
      output_tokens: 3,
    },
  );
});

test("terminal-kind measurement snapshots remain immutable on schema v34", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-result-snapshot-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  await createQueuedReviewRun(core, { reviewCount: 3 });

  let observedAt = 20;
  let worker = 0;
  const claims = createReviewRunClaimService(core, {
    createWorkerId: () => `snapshot-worker-${++worker}`,
    now: () => observedAt,
  });
  const evidence = createReviewRunEvidenceService(core);
  const results = createReviewRunResultService(core, {
    now: () => observedAt,
  });

  const evidencedFailure = claims.claimNext();
  assert.ok(evidencedFailure);
  claims.start(evidencedFailure, "0.145.0");
  evidence.complete(evidencedFailure, {
    exitCode: 1,
    signal: null,
    tokenCounters: {
      cached_input_tokens: 4,
      input_tokens: 13,
      output_tokens: 6,
    },
  });
  observedAt = 30;
  results.fail(
    evidencedFailure,
    new ReviewRunExecutionError("codex_process_failed", "Codex process failed"),
  );

  const unevidencedFailure = claims.claimNext();
  assert.ok(unevidencedFailure);
  claims.start(unevidencedFailure, "0.145.0");
  observedAt = 40;
  results.fail(
    unevidencedFailure,
    new ReviewRunExecutionError(
      "codex_process_failed",
      "Codex process failed before evidence",
    ),
  );
  assert.throws(
    () =>
      evidence.complete(unevidencedFailure, {
        exitCode: 2,
        signal: null,
        tokenCounters: {
          cached_input_tokens: null,
          input_tokens: null,
          output_tokens: null,
        },
      }),
    /terminal evidence must precede failure authority/,
  );

  const deadlineFailure = claims.claimNext();
  assert.ok(deadlineFailure);
  claims.start(deadlineFailure, "0.145.0");
  observedAt = 50;
  results.fail(
    deadlineFailure,
    new ReviewRunExecutionError(
      "deadline_exceeded",
      "Codex Review Run exceeded its deadline",
    ),
  );

  const reader = createEvaluationResultResourceReader(core);
  const result = reader.readResult("evaluation-1");
  for (const reviewRun of result.review_runs) {
    assert.deepEqual(
      reader.readReviewRun("evaluation-1", reviewRun.id),
      reviewRun,
    );
  }
  assert.deepEqual(
    result.review_runs.find(({ id }) => id === evidencedFailure.workId)
      ?.measurements,
    {
      codex_cli_version: "0.145.0",
      duration_ms: 10,
      process: { code: 1, kind: "exit" },
      token_counters: {
        cached_input_tokens: 4,
        input_tokens: 13,
        output_tokens: 6,
      },
    },
  );
  for (const claim of [unevidencedFailure, deadlineFailure]) {
    assert.deepEqual(
      result.review_runs.find(({ id }) => id === claim.workId)?.measurements,
      {
        codex_cli_version: "0.145.0",
        duration_ms: 10,
        process: { kind: "unavailable" },
        token_counters: {
          cached_input_tokens: null,
          input_tokens: null,
          output_tokens: null,
        },
      },
    );
  }

  evidence.complete(deadlineFailure, {
    exitCode: null,
    signal: "SIGKILL",
    tokenCounters: {
      cached_input_tokens: 1,
      input_tokens: 8,
      output_tokens: 2,
    },
  });
  assert.deepEqual(reader.readResult("evaluation-1"), result);
  assert.deepEqual(
    readReviewRunDiagnostics(core, "evaluation-1", deadlineFailure.workId)
      ?.process,
    { kind: "signal", signal: "SIGKILL" },
  );
});
