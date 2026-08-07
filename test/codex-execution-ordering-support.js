import { createWaiverBatchService } from "../src/waiver-batch.js";
import { seedCompletedEvaluation } from "./support/waiver-batch-fixture.js";

/** @param {any} core @param {{adjudicationReadyAt: number, reviewRunReadyAt: number}} times */
export function seedQueuedCodexExecutionKinds(
  core,
  { adjudicationReadyAt, reviewRunReadyAt },
) {
  seedCompletedEvaluation(core);
  createWaiverBatchService(core, {
    createAdjudicationId: () => "adjudication-a",
    createRequestId: () => "request-a",
    now: () => adjudicationReadyAt,
    readCodexCapabilityFailure: () => null,
    storageReserve: { assertWorkAdmissionAvailable() {} },
  }).submit({
    channel: "browser_session",
    evaluationId: "evaluation-1",
    idempotencyKey: "ordering-proof",
    request: {
      requests: [{ finding_id: "finding-1", rationale: "Ordering proof." }],
    },
  });
  core.run(
    `INSERT INTO evaluations (
       id, repository_id, provenance,
       base_selector_type, base_selector_value,
       head_selector_type, head_selector_value,
       base_commit, head_commit, execution_status,
       applicability_sealed_at, next_attempt_at, created_at
     ) VALUES (
       'evaluation-queued', 'repository-1', 'explicit',
       'commit', ?, 'commit', ?, ?, ?, 'queued', NULL, NULL, ?
     )`,
    "c".repeat(40),
    "d".repeat(40),
    "c".repeat(40),
    "d".repeat(40),
    reviewRunReadyAt,
  );
  core.run(
    `INSERT INTO review_runs (
       id, evaluation_id, review_id, review_version_id,
       execution_status, created_at
     ) VALUES (
       'review-run-z', 'evaluation-queued', 'review-1', 'version-1',
       'queued', ?
     )`,
    reviewRunReadyAt,
  );
  core.run(
    `INSERT INTO codex_execution_queue (
       work_id, work_kind, ready_at, accepted_at
     ) VALUES ('review-run-z', 'review_run', ?, ?)`,
    reviewRunReadyAt,
    reviewRunReadyAt,
  );
}
