import { createHash } from "node:crypto";

import { validateCodexConfiguration } from "./codex-capabilities.js";
import {
  failEvaluation,
  requireIdempotencyKey,
} from "./evaluation-validation.js";
import { assertReviewRunCapacity } from "./review-run-admission.js";
import { assertWaiverRecoveryRepositoryAvailable } from "./waiver-recovery-admission.js";
import { EVALUATION_SELECTION, readEvaluation } from "./evaluation-resource.js";

/** @param {any} access @param {string} route @param {string} key @param {string} hash */
function readReplay(access, route, key, hash) {
  const replay = access.get(
    `SELECT request_hash, response_status, response_body
     FROM evaluation_pre_start_retries
     WHERE route = ? AND idempotency_key = ?`,
    route,
    key,
  );
  if (!replay) {
    return false;
  }
  if (replay.request_hash !== hash) {
    failEvaluation(
      "idempotency_conflict",
      "Idempotency key was already used with different input",
    );
  }
  let resource;
  try {
    resource = JSON.parse(replay.response_body);
  } catch {
    throw new TypeError("Evaluation pre-start retry replay is invalid");
  }
  return { resource, status: replay.response_status };
}

/** @param {any} access @param {string} evaluationId */
function readEvaluationRetryState(access, evaluationId) {
  return access.get(
    `SELECT evaluations.id, evaluations.repository_id,
            evaluations.execution_status,
            (
              SELECT count(*) FROM codex_execution_queue
              JOIN review_runs
                ON review_runs.id = codex_execution_queue.work_id
               AND codex_execution_queue.work_kind = 'review_run'
              WHERE review_runs.evaluation_id = evaluations.id
                AND review_runs.execution_status = 'queued'
                AND review_runs.started_at IS NULL
                AND codex_execution_queue.started_at IS NULL
                AND codex_execution_queue.retry_state = 'exhausted'
            ) AS exhausted_count
     FROM evaluations WHERE evaluations.id = ?`,
    evaluationId,
  );
}

/**
 * @param {any} durableCore
 * @param {{
 *   now: () => number,
 *   readCodexCapabilityFailure: () => (Error & {code: string}) | null,
 *   storageReserve: {assertWorkAdmissionAvailable: () => unknown}
 * }} options
 */
export function createEvaluationPreStartRetryService(
  durableCore,
  { now, readCodexCapabilityFailure, storageReserve },
) {
  if (
    typeof durableCore?.transaction !== "function" ||
    typeof now !== "function" ||
    typeof readCodexCapabilityFailure !== "function" ||
    typeof storageReserve?.assertWorkAdmissionAvailable !== "function"
  ) {
    throw new TypeError("Evaluation pre-start retry dependencies are invalid");
  }
  return {
    /**
     * @param {{
     *   channel: "browser_session" | "implementer_token" | "mcp",
     *   evaluationId: string,
     *   idempotencyKey: unknown
     * }} input
     */
    retry({ channel, evaluationId, idempotencyKey }) {
      if (channel !== "browser_session") {
        failEvaluation(
          "evaluation_pre_start_retry_forbidden",
          "Only the operator may retry an Evaluation",
        );
      }
      if (typeof evaluationId !== "string" || evaluationId.length === 0) {
        throw new TypeError("Evaluation pre-start retry identity is invalid");
      }
      const key = requireIdempotencyKey(idempotencyKey);
      const route = `/api/v1/evaluations/${evaluationId}/retry`;
      const hash = createHash("sha256").update(evaluationId).digest("hex");
      const replay = readReplay(durableCore, route, key, hash);
      if (replay) {
        return replay;
      }
      const state = readEvaluationRetryState(durableCore, evaluationId);
      if (!state) {
        failEvaluation("evaluation_not_found", "Evaluation was not found");
      }
      if (state.execution_status !== "queued" || state.exhausted_count < 1) {
        failEvaluation(
          "evaluation_pre_start_retry_not_exhausted",
          "Evaluation has not exhausted pre-start retry",
        );
      }
      const retriedAt = now();
      if (!Number.isSafeInteger(retriedAt) || retriedAt < 0) {
        throw new TypeError("Evaluation pre-start retry time is invalid");
      }
      storageReserve.assertWorkAdmissionAvailable();
      const capabilityFailure = readCodexCapabilityFailure();
      if (capabilityFailure) {
        throw capabilityFailure;
      }
      return durableCore.transaction((/** @type {any} */ transaction) => {
        const transactionReplay = readReplay(transaction, route, key, hash);
        if (transactionReplay) {
          return transactionReplay;
        }
        const current = readEvaluationRetryState(transaction, evaluationId);
        if (!current) {
          failEvaluation("evaluation_not_found", "Evaluation was not found");
        }
        if (
          current.execution_status !== "queued" ||
          current.exhausted_count < 1
        ) {
          failEvaluation(
            "evaluation_pre_start_retry_not_exhausted",
            "Evaluation has not exhausted pre-start retry",
          );
        }
        assertWaiverRecoveryRepositoryAvailable(
          transaction,
          current.repository_id,
          retriedAt,
          false,
        );
        const exhausted = transaction.all(
          `SELECT review_runs.id, review_runs.retry_cycle,
                  review_versions.model, review_versions.reasoning_effort,
                  review_versions.service_tier,
                  codex_execution_queue.worker_id,
                  codex_execution_queue.lease_expires_at
           FROM review_runs
           JOIN review_versions
             ON review_versions.id = review_runs.review_version_id
           JOIN codex_execution_queue
             ON codex_execution_queue.work_id = review_runs.id
            AND codex_execution_queue.work_kind = 'review_run'
           WHERE review_runs.evaluation_id = ?
             AND review_runs.execution_status = 'queued'
             AND review_runs.started_at IS NULL
             AND codex_execution_queue.started_at IS NULL
             AND codex_execution_queue.retry_state = 'exhausted'
           ORDER BY review_runs.id`,
          evaluationId,
        );
        if (exhausted.length !== current.exhausted_count) {
          failEvaluation(
            "evaluation_pre_start_retry_conflict",
            "Evaluation pre-start retry state changed",
          );
        }
        const queuedCount = transaction.get(
          "SELECT count(*) AS count FROM codex_execution_queue WHERE started_at IS NULL",
        )?.count;
        assertReviewRunCapacity(queuedCount, 0);
        for (const run of exhausted) {
          validateCodexConfiguration({
            model: run.model,
            reasoning_effort: run.reasoning_effort,
            service_tier: run.service_tier,
          });
          if (
            run.worker_id !== null &&
            (!Number.isSafeInteger(run.lease_expires_at) ||
              run.lease_expires_at > retriedAt)
          ) {
            failEvaluation(
              "evaluation_pre_start_retry_conflict",
              "Evaluation pre-start retry state changed",
            );
          }
          if (
            transaction.run(
              `UPDATE review_runs SET retry_cycle = retry_cycle + 1
               WHERE id = ? AND retry_cycle = ?
                 AND execution_status = 'queued' AND started_at IS NULL`,
              run.id,
              run.retry_cycle,
            ).changes !== 1 ||
            transaction.run(
              `UPDATE codex_execution_queue
               SET ready_at = ?, retry_state = 'ready'
               WHERE work_id = ? AND work_kind = 'review_run'
                 AND started_at IS NULL AND retry_state = 'exhausted'
                 AND (worker_id IS NULL OR lease_expires_at <= ?)`,
              retriedAt,
              run.id,
              retriedAt,
            ).changes !== 1
          ) {
            failEvaluation(
              "evaluation_pre_start_retry_conflict",
              "Evaluation pre-start retry state changed",
            );
          }
        }
        const resource = readEvaluation(
          transaction.get(
            `${EVALUATION_SELECTION} WHERE evaluations.id = ?`,
            evaluationId,
          ),
        );
        const responseStatus = 200;
        const responseBody = JSON.stringify(resource);
        transaction.run(
          `INSERT INTO evaluation_pre_start_retries (
             route, idempotency_key, request_hash, evaluation_id,
             response_status, response_body, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          route,
          key,
          hash,
          evaluationId,
          responseStatus,
          responseBody,
          retriedAt,
        );
        return { resource, status: responseStatus };
      });
    },
  };
}
