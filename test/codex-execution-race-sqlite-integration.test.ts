import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openDurableCore } from "../src/durable/durable-core.ts";
import { createEvaluationService } from "../src/evaluation/evaluation.ts";
import { createReviewRunClaimService } from "../src/review/review-run-claim.ts";
import {
  createReviewRunResultService,
  ReviewRunExecutionError,
} from "../src/review/review-run-result.ts";
import { createWaiverAdjudicationClaimService } from "../src/waiver/waiver-adjudication-claim.ts";
import { createWaiverAdjudicationResultService } from "../src/waiver/waiver-adjudication-result-service.ts";
import { createWaiverBatchService } from "../src/waiver/waiver-batch.ts";
import { createQueuedReviewRun } from "./review-run-claim-support.ts";
import { seedCompletedEvaluation } from "./support/waiver-batch-fixture.ts";

function reviewCandidate(core: any) {
  return {
    criterion_results: core
      .all(
        `SELECT criterion_id FROM review_version_criteria
         WHERE review_version_id = (
           SELECT review_version_id FROM review_runs WHERE id = 'review-run-1'
         ) ORDER BY position`,
      )
      .map(({ criterion_id: criterionId }: { criterion_id: string }) => ({
        criterion_id: criterionId,
        outcome: "clear",
      })),
  };
}

function evaluationService(core: any, now: () => number) {
  return createEvaluationService(core, {
    acquireChangeset: async () => assert.fail("race proof does not acquire"),
    masterKey: Buffer.alloc(32, 7),
    now,
    readCodexCapabilityFailure: () => null,
    storageReserve: { assertWorkAdmissionAvailable() {} },
  });
}

for (const [name, submissionFirst] of [
  ["accepted submission", true],
  ["cancellation", false],
]) {
  test(`durable commit order gives ${name} the Review Run race`, async (context) => {
    const directory = mkdtempSync(join(tmpdir(), "quality-bar-review-race-"));
    context.after(() => rmSync(directory, { force: true, recursive: true }));
    const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
    context.after(() => core.close());
    await createQueuedReviewRun(core);
    let now = 20;
    const claims = createReviewRunClaimService(core, {
      createWorkerId: () => "review-worker",
      now: () => now,
    });
    const claim = claims.claimNext();
    assert.ok(claim);
    claims.start(claim, "0.145.0");
    const results = createReviewRunResultService(core, { now: () => now });

    if (submissionFirst) {
      results.prepare(claim, reviewCandidate(core), []);
      now = 21;
      assert.throws(
        () => evaluationService(core, () => now).cancel("evaluation-1"),
        (error) =>
          error instanceof Error &&
          "code" in error &&
          error.code === "evaluation_not_cancellable",
      );
      assert.equal(
        core.get("SELECT count(*) AS count FROM criterion_results")?.count,
        1,
      );
      return;
    }

    now = 21;
    evaluationService(core, () => now).cancel("evaluation-1");
    now = 22;
    assert.throws(
      () => results.prepare(claim, reviewCandidate(core), []),
      (error) =>
        error instanceof ReviewRunExecutionError &&
        error.code === "submission_channel_closed" &&
        error.message === "Review Run submission channel is closed",
    );
    assert.equal(
      core.get("SELECT count(*) AS count FROM criterion_results")?.count,
      0,
    );
  });
}

test("lease replacement fences a stale Review Run submission without a partial Result", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-review-lease-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  await createQueuedReviewRun(core);
  let now = 20;
  let worker = 0;
  const claims = createReviewRunClaimService(core, {
    createWorkerId: () => `review-worker-${++worker}`,
    now: () => now,
  });
  const expired = claims.claimNext();
  assert.ok(expired);
  now = 120_020;
  const replacement = claims.claimNext();
  assert.ok(replacement);
  assert.equal(replacement.fencingToken, 2);
  claims.start(replacement, "0.145.0");
  const results = createReviewRunResultService(core, { now: () => now });
  assert.throws(
    () => results.prepare(expired, reviewCandidate(core), []),
    (error) =>
      error instanceof ReviewRunExecutionError &&
      error.code === "submission_channel_closed" &&
      error.message === "Review Run submission channel is closed",
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM criterion_results")?.count,
    0,
  );
  results.prepare(replacement, reviewCandidate(core), []);
  assert.equal(
    core.get("SELECT count(*) AS count FROM criterion_results")?.count,
    1,
  );
  assert.throws(
    () => results.prepare(expired, reviewCandidate(core), []),
    (error) =>
      error instanceof ReviewRunExecutionError &&
      error.code === "submission_channel_closed" &&
      error.message === "Review Run submission channel is closed",
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM criterion_results")?.count,
    1,
  );
});

test("durable Waiver Adjudication cancellation closes submission before a Decision set can commit", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-waiver-cancel-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  seedCompletedEvaluation(core);
  createWaiverBatchService(core, {
    createAdjudicationId: () => "adjudication-1",
    createRequestId: () => "request-1",
    now: () => 10,
    readCodexCapabilityFailure: () => null,
    storageReserve: { assertWorkAdmissionAvailable() {} },
  }).submit({
    channel: "browser_session",
    evaluationId: "evaluation-1",
    idempotencyKey: "waiver-cancellation-race",
    request: {
      requests: [{ finding_id: "finding-1", rationale: "Exact exception." }],
    },
  });
  const claims = createWaiverAdjudicationClaimService(core, {
    createWorkerId: () => "waiver-worker",
    now: () => 20,
  });
  const claim = claims.claimNext();
  assert.ok(claim);
  claims.start(claim, "0.145.0");
  core.run(
    `UPDATE waiver_adjudications
     SET execution_status = 'cancelled', completed_at = 21
     WHERE id = 'adjudication-1'`,
  );
  const results = createWaiverAdjudicationResultService(core, {
    createDecisionId: () => "decision-1",
    now: () => 22,
  });
  assert.throws(
    () =>
      results.prepare(claim, {
        decisions: [
          {
            explanation: "The frozen evidence justifies this exception.",
            outcome: "accepted",
            request_id: "request-1",
          },
        ],
      }),
    (error) =>
      error instanceof ReviewRunExecutionError &&
      error.code === "submission_channel_closed" &&
      error.message === "Waiver Adjudication submission channel is closed",
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM waiver_decisions")?.count,
    0,
  );
});

test("accepted Waiver Adjudication Decision set wins before cancellation", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-waiver-win-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  seedCompletedEvaluation(core);
  createWaiverBatchService(core, {
    createAdjudicationId: () => "adjudication-1",
    createRequestId: () => "request-1",
    now: () => 10,
    readCodexCapabilityFailure: () => null,
    storageReserve: { assertWorkAdmissionAvailable() {} },
  }).submit({
    channel: "browser_session",
    evaluationId: "evaluation-1",
    idempotencyKey: "waiver-acceptance-race",
    request: {
      requests: [{ finding_id: "finding-1", rationale: "Exact exception." }],
    },
  });
  const claims = createWaiverAdjudicationClaimService(core, {
    createWorkerId: () => "waiver-worker",
    now: () => 20,
  });
  const claim = claims.claimNext();
  assert.ok(claim);
  claims.start(claim, "0.145.0");
  createWaiverAdjudicationResultService(core, {
    createDecisionId: () => "decision-1",
    now: () => 21,
  }).prepare(claim, {
    decisions: [
      {
        explanation: "The frozen evidence justifies this exact exception.",
        outcome: "accepted",
        request_id: "request-1",
      },
    ],
  });
  assert.throws(
    () =>
      core.run(
        `UPDATE waiver_adjudications
           SET execution_status = 'cancelled', completed_at = 22
           WHERE id = 'adjudication-1'`,
      ),
    /waiver_adjudication_terminal_immutable/,
  );
  assert.deepEqual(
    core.get(
      `SELECT execution_status, completed_at
       FROM waiver_adjudications WHERE id = 'adjudication-1'`,
    ),
    { completed_at: 21, execution_status: "completed" },
  );
  assert.deepEqual(
    core.get("SELECT outcome FROM waiver_decisions WHERE id = 'decision-1'"),
    { outcome: "accepted" },
  );
});

test("lease replacement fences a stale Waiver Adjudication Decision set without partial Decisions", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-waiver-lease-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  seedCompletedEvaluation(core);
  createWaiverBatchService(core, {
    createAdjudicationId: () => "adjudication-1",
    createRequestId: () => "request-1",
    now: () => 10,
    readCodexCapabilityFailure: () => null,
    storageReserve: { assertWorkAdmissionAvailable() {} },
  }).submit({
    channel: "browser_session",
    evaluationId: "evaluation-1",
    idempotencyKey: "waiver-race",
    request: {
      requests: [{ finding_id: "finding-1", rationale: "Exact exception." }],
    },
  });
  let now = 20;
  let worker = 0;
  const claims = createWaiverAdjudicationClaimService(core, {
    createWorkerId: () => `waiver-worker-${++worker}`,
    now: () => now,
  });
  const expired = claims.claimNext();
  assert.ok(expired);
  now = 120_020;
  const replacement = claims.claimNext();
  assert.ok(replacement);
  assert.equal(replacement.fencingToken, 2);
  claims.start(replacement, "0.145.0");
  const results = createWaiverAdjudicationResultService(core, {
    createDecisionId: () => "decision-1",
    now: () => now,
  });
  const candidate = {
    decisions: [
      {
        explanation: "The frozen evidence justifies this exact exception.",
        outcome: "accepted",
        request_id: "request-1",
      },
    ],
  };
  assert.throws(
    () => results.prepare(expired, candidate),
    (error) =>
      error instanceof ReviewRunExecutionError &&
      error.code === "submission_channel_closed" &&
      error.message === "Waiver Adjudication submission channel is closed",
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM waiver_decisions")?.count,
    0,
  );
  results.prepare(replacement, candidate);
  assert.equal(
    core.get("SELECT count(*) AS count FROM waiver_decisions")?.count,
    1,
  );
  assert.throws(
    () => results.prepare(expired, candidate),
    (error) =>
      error instanceof ReviewRunExecutionError &&
      error.code === "submission_channel_closed" &&
      error.message === "Waiver Adjudication submission channel is closed",
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM waiver_decisions")?.count,
    1,
  );
});
