import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createCodexExecutionClaimService } from "../src/codex-execution-claim.js";
import { recoverCodexExecutions } from "../src/codex-execution-recovery.js";
import { openDurableCore } from "../src/durable-core.js";
import { createEvaluationService } from "../src/evaluation.js";
import { createReviewRunResultService } from "../src/review-run-result.js";
import { createWaiverAdjudicationResultService } from "../src/waiver-adjudication-result-service.js";
import { seedQueuedCodexExecutionKinds } from "./codex-execution-ordering-support.js";
import { createQueuedReviewRun } from "./review-run-claim-support.js";

/** @param {import("node:test").TestContext} context */
function createCore(context) {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-recovery-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite"));
  context.after(() => core.close());
  return core;
}

test("restart releases an abandoned pre-start claim without consuming queued work", async (context) => {
  const core = createCore(context);
  await createQueuedReviewRun(core);
  const claim = createCodexExecutionClaimService(core, {
    createWorkerId: () => "pre-start-worker",
    now: () => 20,
  }).claimNext();
  assert.ok(claim);

  recoverCodexExecutions(core, { now: () => 30 });

  assert.deepEqual(
    core.get(
      `SELECT review_runs.execution_status,
              codex_execution_queue.started_at,
              codex_execution_queue.fencing_token,
              codex_execution_queue.lease_expires_at
       FROM review_runs
       JOIN codex_execution_queue
         ON codex_execution_queue.work_id = review_runs.id
       WHERE review_runs.id = 'review-run-1'`,
    ),
    {
      execution_status: "queued",
      fencing_token: 1,
      lease_expires_at: 30,
      started_at: null,
    },
  );
});

test("restart fails an interrupted Review Run exactly without a partial Result or retry", async (context) => {
  const core = createCore(context);
  await createQueuedReviewRun(core);
  const claims = createCodexExecutionClaimService(core, {
    createWorkerId: () => "started-review-worker",
    now: () => 20,
  });
  const claim = claims.claimNext();
  assert.ok(claim);
  claims.start(claim, "0.145.0");

  recoverCodexExecutions(core, { now: () => 30 });

  assert.deepEqual(
    core.get(
      `SELECT execution_status, completed_at, error_code, error_detail
       FROM review_runs WHERE id = 'review-run-1'`,
    ),
    {
      completed_at: 30,
      error_code: "unexpected_execution_failure",
      error_detail: "Review Run was interrupted by application restart",
      execution_status: "failed",
    },
  );
  assert.deepEqual(
    core.get(
      `SELECT execution_status, completed_at
       FROM evaluations WHERE id = 'evaluation-1'`,
    ),
    { completed_at: 30, execution_status: "completed" },
  );
  assert.equal(
    core.get(
      "SELECT outcome FROM evaluation_results WHERE evaluation_id = 'evaluation-1'",
    )?.outcome,
    "error",
  );
  assert.equal(
    core.get(
      "SELECT count(*) AS count FROM criterion_results WHERE review_run_id = 'review-run-1'",
    )?.count,
    0,
  );
  assert.equal(
    core.get(
      "SELECT started_at FROM codex_execution_queue WHERE work_id = 'review-run-1'",
    )?.started_at,
    20,
  );
});

test("restart fails an interrupted Waiver Adjudication without Decisions or automatic retry", (context) => {
  const core = createCore(context);
  seedQueuedCodexExecutionKinds(core, {
    adjudicationReadyAt: 10,
    reviewRunReadyAt: 40,
  });
  const claims = createCodexExecutionClaimService(core, {
    createWorkerId: () => "started-waiver-worker",
    now: () => 20,
  });
  const claim = claims.claimNext();
  assert.ok(claim);
  assert.equal(claim.workKind, "waiver_adjudication");
  claims.start(claim, "0.145.0");

  recoverCodexExecutions(core, { now: () => 30 });

  assert.deepEqual(
    core.get(
      `SELECT execution_status, completed_at, error_code, error_detail
       FROM waiver_adjudications WHERE id = 'adjudication-a'`,
    ),
    {
      completed_at: 30,
      error_code: "unexpected_execution_failure",
      error_detail:
        "Waiver Adjudication was interrupted by application restart",
      execution_status: "failed",
    },
  );
  assert.equal(
    core.get(
      "SELECT count(*) AS count FROM waiver_decisions WHERE waiver_adjudication_id = 'adjudication-a'",
    )?.count,
    0,
  );
  assert.equal(
    core.get(
      "SELECT started_at FROM codex_execution_queue WHERE work_id = 'adjudication-a'",
    )?.started_at,
    20,
  );
});

test("a started execution durably tracks exactly one detached process group", async (context) => {
  const core = createCore(context);
  await createQueuedReviewRun(core);
  const claims = createCodexExecutionClaimService(core, {
    createWorkerId: () => "process-group-worker",
    now: () => 20,
  });
  const claim = claims.claimNext();
  assert.ok(claim);
  claims.start(claim, "0.145.0");

  claims.trackProcessGroup(claim, 4321);

  assert.deepEqual(
    core.get(
      `SELECT process_group_id, process_group_recorded_at
       FROM codex_execution_queue WHERE work_id = 'review-run-1'`,
    ),
    { process_group_id: 4321, process_group_recorded_at: 20 },
  );
  assert.throws(
    () => claims.trackProcessGroup(claim, 4322),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "review_run_claim_lost",
  );
  claims.finishProcessGroup(claim);
  assert.equal(
    core.get(
      `SELECT process_group_finished_at FROM codex_execution_queue
       WHERE work_id = 'review-run-1'`,
    )?.process_group_finished_at,
    20,
  );
  assert.throws(
    () => claims.finishProcessGroup(claim),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "review_run_claim_lost",
  );
});

test("an accepted Review Run submission wins restart recovery exactly", async (context) => {
  const core = createCore(context);
  await createQueuedReviewRun(core);
  const claims = createCodexExecutionClaimService(core, {
    createWorkerId: () => "submitted-review-worker",
    now: () => 20,
  });
  const claim = claims.claimNext();
  assert.ok(claim);
  claims.start(claim, "0.145.0");
  claims.trackProcessGroup(claim, 4321);
  const criterionId = core.get(
    `SELECT criterion_id FROM review_version_criteria
     WHERE review_version_id = (
       SELECT review_version_id FROM review_runs WHERE id = 'review-run-1'
     )`,
  )?.criterion_id;
  createReviewRunResultService(core, { now: () => 25 }).prepare(
    claim,
    {
      criterion_results: [{ criterion_id: criterionId, outcome: "clear" }],
    },
    [],
  );

  recoverCodexExecutions(core, {
    now: () => 30,
    terminateProcessGroup(processGroupId) {
      assert.equal(processGroupId, 4321);
      return "SIGTERM";
    },
  });

  assert.deepEqual(
    core.get(
      `SELECT review_runs.execution_status, review_runs.completed_at,
              evaluation_results.outcome,
              codex_execution_queue.recovery_termination_signal,
              codex_execution_queue.recovered_at
       FROM review_runs
       JOIN evaluation_results
         ON evaluation_results.evaluation_id = review_runs.evaluation_id
       JOIN codex_execution_queue
         ON codex_execution_queue.work_id = review_runs.id
       WHERE review_runs.id = 'review-run-1'`,
    ),
    {
      completed_at: 25,
      execution_status: "completed",
      outcome: "clear",
      recovered_at: 30,
      recovery_termination_signal: "SIGTERM",
    },
  );
});

test("restart never signals a process group already observed terminal", async (context) => {
  const core = createCore(context);
  await createQueuedReviewRun(core);
  const claims = createCodexExecutionClaimService(core, {
    createWorkerId: () => "finished-process-worker",
    now: () => 20,
  });
  const claim = claims.claimNext();
  assert.ok(claim);
  claims.start(claim, "0.145.0");
  claims.trackProcessGroup(claim, 4321);
  claims.finishProcessGroup(claim);
  const criterionId = core.get(
    `SELECT criterion_id FROM review_version_criteria
     WHERE review_version_id = (
       SELECT review_version_id FROM review_runs WHERE id = 'review-run-1'
     )`,
  )?.criterion_id;
  createReviewRunResultService(core, { now: () => 25 }).prepare(
    claim,
    {
      criterion_results: [{ criterion_id: criterionId, outcome: "clear" }],
    },
    [],
  );

  recoverCodexExecutions(core, {
    now: () => 30,
    terminateProcessGroup() {
      return assert.fail("finished process group was signaled");
    },
  });

  assert.deepEqual(
    core.get(
      `SELECT process_group_finished_at, recovery_termination_signal,
              recovered_at
       FROM codex_execution_queue WHERE work_id = 'review-run-1'`,
    ),
    {
      process_group_finished_at: 20,
      recovered_at: 30,
      recovery_termination_signal: null,
    },
  );
});

test("durable Evaluation cancellation wins restart recovery exactly", async (context) => {
  const core = createCore(context);
  await createQueuedReviewRun(core);
  const claims = createCodexExecutionClaimService(core, {
    createWorkerId: () => "cancelled-review-worker",
    now: () => 20,
  });
  const claim = claims.claimNext();
  assert.ok(claim);
  claims.start(claim, "0.145.0");
  claims.trackProcessGroup(claim, 4321);
  createEvaluationService(core, {
    acquireChangeset: async () => assert.fail("cancellation acquired work"),
    masterKey: Buffer.alloc(32, 7),
    now: () => 25,
    readCodexCapabilityFailure: () => null,
    storageReserve: { assertWorkAdmissionAvailable() {} },
  }).cancel("evaluation-1");

  recoverCodexExecutions(core, {
    now: () => 30,
    terminateProcessGroup: () => "SIGKILL",
  });

  assert.deepEqual(
    core.get(
      `SELECT review_runs.execution_status, review_runs.completed_at,
              review_runs.error_code, evaluations.execution_status AS evaluation_status,
              evaluation_results.outcome,
              codex_execution_queue.recovery_termination_signal
       FROM review_runs
       JOIN evaluations ON evaluations.id = review_runs.evaluation_id
       JOIN evaluation_results
         ON evaluation_results.evaluation_id = evaluations.id
       JOIN codex_execution_queue
         ON codex_execution_queue.work_id = review_runs.id
       WHERE review_runs.id = 'review-run-1'`,
    ),
    {
      completed_at: 25,
      error_code: null,
      evaluation_status: "cancelled",
      execution_status: "cancelled",
      outcome: "error",
      recovery_termination_signal: "SIGKILL",
    },
  );
});

test("an accepted Waiver Decision set wins restart recovery exactly", (context) => {
  const core = createCore(context);
  seedQueuedCodexExecutionKinds(core, {
    adjudicationReadyAt: 10,
    reviewRunReadyAt: 40,
  });
  const claims = createCodexExecutionClaimService(core, {
    createWorkerId: () => "submitted-waiver-worker",
    now: () => 20,
  });
  const claim = claims.claimNext();
  assert.ok(claim);
  claims.start(claim, "0.145.0");
  claims.trackProcessGroup(claim, 4321);
  const requestId = core.get(
    `SELECT waiver_request_id
     FROM waiver_adjudication_requests
     WHERE waiver_adjudication_id = 'adjudication-a'`,
  )?.waiver_request_id;
  createWaiverAdjudicationResultService(core, {
    createDecisionId: () => "decision-recovered",
    now: () => 25,
  }).prepare(claim, {
    decisions: [
      {
        explanation: "The exception is not justified.",
        outcome: "denied",
        request_id: requestId,
      },
    ],
  });

  recoverCodexExecutions(core, {
    now: () => 30,
    terminateProcessGroup: () => "SIGTERM",
  });

  assert.deepEqual(
    core.get(
      `SELECT waiver_adjudications.execution_status,
              waiver_adjudications.completed_at,
              waiver_decisions.outcome,
              codex_execution_queue.recovery_termination_signal
       FROM waiver_adjudications
       JOIN waiver_decisions
         ON waiver_decisions.waiver_adjudication_id = waiver_adjudications.id
       JOIN codex_execution_queue
         ON codex_execution_queue.work_id = waiver_adjudications.id
       WHERE waiver_adjudications.id = 'adjudication-a'`,
    ),
    {
      completed_at: 25,
      execution_status: "completed",
      outcome: "denied",
      recovery_termination_signal: "SIGTERM",
    },
  );
});
