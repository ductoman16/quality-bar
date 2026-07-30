import { createWaiverAdjudicationResultService } from "../../src/waiver-adjudication-result-service.js";
import { createWaiverBatchService } from "../../src/waiver-batch.js";

/** @param {any} core @param {number} index @param {string} rationale */
export function prepareDeniedWaiverRequest(core, index, rationale) {
  const adjudicationId = `prior-adjudication-${index}`;
  const requestId = `prior-request-${index}`;
  const workerId = `prior-worker-${index}`;
  createWaiverBatchService(core, {
    createAdjudicationId: () => adjudicationId,
    createRequestId: () => requestId,
    now: () => index,
    readCodexCapabilityFailure: () => null,
    storageReserve: { assertWorkAdmissionAvailable() {} },
  }).submit({
    channel: "browser_session",
    evaluationId: "evaluation-1",
    idempotencyKey: `prior-key-${index}`,
    request: {
      requests: [{ finding_id: "finding-1", rationale }],
    },
  });
  core.run(
    `UPDATE codex_execution_queue
     SET worker_id = ?, fencing_token = 1,
         lease_expires_at = 100, started_at = ?
     WHERE work_id = ?`,
    workerId,
    index,
    adjudicationId,
  );
  core.run(
    `UPDATE waiver_adjudications
     SET execution_status = 'running', started_at = ?,
         codex_cli_version = '0.145.0'
     WHERE id = ?`,
    index,
    adjudicationId,
  );
  createWaiverAdjudicationResultService(core, {
    createDecisionId: () => `prior-decision-${index}`,
    now: () => index,
  }).prepare(
    { fencingToken: 1, workerId, workId: adjudicationId },
    {
      decisions: [
        {
          explanation: "The prior rationale did not justify an exception.",
          outcome: "denied",
          request_id: requestId,
        },
      ],
    },
  );
}
