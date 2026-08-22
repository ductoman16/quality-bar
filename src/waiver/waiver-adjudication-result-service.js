import { randomUUID } from "node:crypto";

import { ReviewRunExecutionError } from "../review/review-run-result.js";
import { validateWaiverAdjudicationSubmission } from "./waiver-adjudication-result.js";

/** @param {string} code @param {string} message @returns {never} */
function fail(code, message) {
  throw new ReviewRunExecutionError(code, message);
}

/** @param {any} transaction @param {any} claim @param {number} observedAt */
function readAuthoritativeAdjudication(transaction, claim, observedAt) {
  const adjudication = transaction.get(
    `SELECT waiver_adjudications.execution_status,
            codex_execution_queue.worker_id,
            codex_execution_queue.fencing_token,
            codex_execution_queue.lease_expires_at
     FROM waiver_adjudications
     JOIN codex_execution_queue
       ON codex_execution_queue.work_id = waiver_adjudications.id
      AND codex_execution_queue.work_kind = 'waiver_adjudication'
     WHERE waiver_adjudications.id = ?`,
    claim.workId,
  );
  if (
    !adjudication ||
    adjudication.execution_status !== "running" ||
    adjudication.worker_id !== claim.workerId ||
    adjudication.fencing_token !== claim.fencingToken ||
    typeof adjudication.lease_expires_at !== "number" ||
    adjudication.lease_expires_at <= observedAt
  ) {
    fail(
      "submission_channel_closed",
      "Waiver Adjudication submission channel is closed",
    );
  }
  return adjudication;
}

/** @param {any} transaction @param {string} adjudicationId */
function readRequests(transaction, adjudicationId) {
  return transaction.all(
    `SELECT waiver_requests.id
     FROM waiver_adjudication_requests
     JOIN waiver_requests
       ON waiver_requests.id =
          waiver_adjudication_requests.waiver_request_id
     WHERE waiver_adjudication_requests.waiver_adjudication_id = ?
     ORDER BY waiver_adjudication_requests.position`,
    adjudicationId,
  );
}

/** @param {any} durableCore @param {{createDecisionId?: () => string, now?: () => number}} [options] */
export function createWaiverAdjudicationResultService(
  durableCore,
  { createDecisionId = randomUUID, now = () => Date.now() } = {},
) {
  const service = {
    /** @param {any} claim @param {Error & {code: string}} failure */
    fail(claim, failure) {
      if (
        !(failure instanceof Error) ||
        !/^[a-z][a-z0-9_]*$/.test(failure.code) ||
        failure.message.trim().length === 0
      ) {
        throw new TypeError("Waiver Adjudication failure is invalid");
      }
      const completedAt = now();
      if (!Number.isSafeInteger(completedAt) || completedAt < 0) {
        throw new TypeError("Waiver Adjudication completion time is invalid");
      }
      return durableCore.transaction((/** @type {any} */ transaction) => {
        readAuthoritativeAdjudication(transaction, claim, completedAt);
        if (
          transaction.run(
            `UPDATE waiver_adjudications
             SET execution_status = 'failed', completed_at = ?,
                 error_code = ?, error_detail = ?
             WHERE id = ? AND execution_status = 'running'`,
            completedAt,
            failure.code,
            failure.message,
            claim.workId,
          ).changes !== 1
        ) {
          fail(
            "submission_channel_closed",
            "Waiver Adjudication submission channel is closed",
          );
        }
      });
    },
    /** @param {any} claim @param {unknown} candidate */
    prepare(claim, candidate) {
      const checkedAt = now();
      if (!Number.isSafeInteger(checkedAt) || checkedAt < 0) {
        throw new TypeError("Waiver Adjudication submission time is invalid");
      }
      return durableCore.transaction((/** @type {any} */ transaction) => {
        readAuthoritativeAdjudication(transaction, claim, checkedAt);
        const requests = readRequests(transaction, claim.workId);
        const decisions = validateWaiverAdjudicationSubmission(
          candidate,
          requests,
        );
        const acceptedAt = now();
        if (!Number.isSafeInteger(acceptedAt) || acceptedAt < checkedAt) {
          throw new TypeError("Waiver Adjudication acceptance time is invalid");
        }
        readAuthoritativeAdjudication(transaction, claim, acceptedAt);
        for (const decision of decisions) {
          const decisionId = createDecisionId();
          if (typeof decisionId !== "string" || decisionId.length === 0) {
            throw new TypeError("Waiver Decision identity is invalid");
          }
          transaction.run(
            `INSERT INTO waiver_decisions (
               id, waiver_adjudication_id, waiver_request_id, outcome,
               explanation, error_code, error_detail, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            decisionId,
            claim.workId,
            decision.request_id,
            decision.outcome,
            decision.explanation ?? null,
            decision.error?.code ?? null,
            decision.error?.detail ?? null,
            acceptedAt,
          );
        }
        if (
          transaction.run(
            `UPDATE waiver_adjudications
             SET execution_status = 'completed', completed_at = ?
             WHERE id = ? AND execution_status = 'running'
               AND completed_at IS NULL`,
            acceptedAt,
            claim.workId,
          ).changes !== 1
        ) {
          fail(
            "submission_channel_closed",
            "Waiver Adjudication submission channel is closed",
          );
        }
      });
    },
  };
  return service;
}
