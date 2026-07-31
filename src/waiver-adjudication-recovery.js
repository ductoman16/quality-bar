import { createHash } from "node:crypto";

import { validateCodexConfiguration } from "./codex-capabilities.js";
import {
  failEvaluation,
  requireIdempotencyKey,
} from "./evaluation-validation.js";
import { assertReviewRunCapacity } from "./review-run-admission.js";
import { freezeWaiverAdjudicatorConfiguration } from "./waiver-adjudicator-configuration.js";
import {
  assertNoActiveWaiverAdjudication,
  queueWaiverAdjudication,
} from "./waiver-adjudication-persistence.js";
import { assertWaiverRecoveryRepositoryAvailable } from "./waiver-recovery-admission.js";

/** @param {any} adjudication */
export function classifyWaiverAdjudicationRecovery(adjudication) {
  if (
    !adjudication ||
    !["ready", "exhausted"].includes(adjudication.retry_state) ||
    !["queued", "running", "completed", "failed", "cancelled"].includes(
      adjudication.execution_status,
    )
  ) {
    failEvaluation(
      "waiver_adjudication_recovery_invalid",
      "Waiver Adjudication recovery state is invalid",
    );
  }
  if (adjudication.execution_status === "queued") {
    if (
      adjudication.retry_state === "exhausted" &&
      adjudication.started_at === null
    ) {
      return "same_identity";
    }
    failEvaluation(
      "waiver_adjudication_recovery_not_exhausted",
      "Waiver Adjudication has not exhausted pre-start retry",
    );
  }
  if (adjudication.execution_status === "running") {
    failEvaluation(
      "waiver_adjudication_active",
      "Waiver Adjudication is running",
    );
  }
  if (adjudication.execution_status === "completed") {
    failEvaluation(
      "waiver_adjudication_decision_retry_required",
      "Completed Waiver Adjudication recovery is owned by Decision retry",
    );
  }
  if (
    ["failed", "cancelled"].includes(adjudication.execution_status) &&
    adjudication.started_at !== null &&
    adjudication.retry_state === "ready"
  ) {
    return "new_adjudication";
  }
  failEvaluation(
    "waiver_adjudication_recovery_invalid",
    "Waiver Adjudication recovery state is invalid",
  );
}

/** @param {any} access @param {string} route @param {string} key @param {string} hash */
function readReplay(access, route, key, hash) {
  const replay = access.get(
    `SELECT request_hash, response_status, response_body
     FROM waiver_recovery_idempotency
     WHERE route = ? AND idempotency_key = ?`,
    route,
    key,
  );
  if (!replay) {
    return null;
  }
  if (replay.request_hash !== hash) {
    failEvaluation(
      "idempotency_conflict",
      "Idempotency key was already used with different input",
    );
  }
  return {
    resource: JSON.parse(replay.response_body),
    status: replay.response_status,
  };
}

/** @param {any} access @param {string} adjudicationId */
function readAdjudication(access, adjudicationId) {
  return access.get(
    `SELECT waiver_adjudications.*,
            evaluations.repository_id,
            codex_execution_queue.accepted_at,
            codex_execution_queue.started_at AS queue_started_at,
            codex_execution_queue.retry_state,
            codex_execution_queue.worker_id,
            codex_execution_queue.lease_expires_at,
            (
              SELECT count(*) FROM waiver_decisions
              WHERE waiver_decisions.waiver_adjudication_id =
                    waiver_adjudications.id
            ) AS decision_count
     FROM waiver_adjudications
     JOIN evaluations
       ON evaluations.id = waiver_adjudications.evaluation_id
     JOIN codex_execution_queue
       ON codex_execution_queue.work_id = waiver_adjudications.id
      AND codex_execution_queue.work_kind = 'waiver_adjudication'
     WHERE waiver_adjudications.id = ?`,
    adjudicationId,
  );
}

/** @param {any} access @param {string} adjudicationId */
function readRequests(access, adjudicationId) {
  return access.all(
    `SELECT waiver_requests.id, waiver_requests.evaluation_id,
            waiver_requests.finding_id, waiver_requests.rationale,
            waiver_requests.created_at
     FROM waiver_adjudication_requests
     JOIN waiver_requests
       ON waiver_requests.id =
          waiver_adjudication_requests.waiver_request_id
     WHERE waiver_adjudication_requests.waiver_adjudication_id = ?
     ORDER BY waiver_adjudication_requests.position`,
    adjudicationId,
  );
}

/** @param {any} transaction @param {string} adjudicationId */
function assertLatestUndecidedRecoverySource(transaction, adjudicationId) {
  const stale = transaction.get(
    `SELECT EXISTS (
       SELECT 1
       FROM waiver_adjudication_requests AS source_requests
       JOIN waiver_adjudication_requests AS later_requests
         ON later_requests.waiver_request_id =
            source_requests.waiver_request_id
       JOIN waiver_adjudications AS source
         ON source.id = source_requests.waiver_adjudication_id
       JOIN waiver_adjudications AS later
         ON later.id = later_requests.waiver_adjudication_id
        AND later.rowid > source.rowid
       WHERE source_requests.waiver_adjudication_id = ?
     ) AS stale`,
    adjudicationId,
  )?.stale;
  if (stale === 1) {
    failEvaluation(
      "waiver_adjudication_recovery_conflict",
      "A later Waiver Adjudication owns recovery for these Requests",
    );
  }
  if (stale !== 0) {
    throw new TypeError("Waiver Adjudication recovery lineage is invalid");
  }
}

/** @param {any} source @param {any[]} requests */
function recoveryResource(source, requests) {
  return {
    adjudication: {
      base_commit: source.base_commit,
      configuration: {
        model: source.model,
        reasoning_effort: source.reasoning_effort,
        service_tier: source.service_tier,
      },
      created_at: new Date(source.created_at).toISOString(),
      evaluation_id: source.evaluation_id,
      execution_status: source.execution_status,
      head_commit: source.head_commit,
      id: source.id,
      request_ids: requests.map((request) => request.id),
    },
    requests: requests.map((request) => ({
      created_at: new Date(request.created_at).toISOString(),
      evaluation_id: request.evaluation_id,
      finding_id: request.finding_id,
      id: request.id,
      rationale: request.rationale,
    })),
  };
}

/** @param {any} transaction @param {any} input */
function persistReplay(transaction, input) {
  transaction.run(
    `INSERT INTO waiver_recovery_idempotency (
       route, idempotency_key, request_hash, response_status,
       response_body, source_adjudication_id,
       recovered_adjudication_id, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    input.route,
    input.key,
    input.hash,
    input.status,
    JSON.stringify(input.resource),
    input.sourceId,
    input.resource.adjudication.id,
    input.createdAt,
  );
  return { resource: input.resource, status: input.status };
}

/**
 * @param {any} durableCore
 * @param {{
 *   createAdjudicationId: () => string,
 *   now: () => number,
 *   readCodexCapabilityFailure: () => (Error & {code: string, unavailable?: boolean}) | null,
 *   storageReserve: {assertWorkAdmissionAvailable: () => unknown}
 * }} options
 */
export function createWaiverAdjudicationRecoveryService(
  durableCore,
  { createAdjudicationId, now, readCodexCapabilityFailure, storageReserve },
) {
  if (
    typeof durableCore?.get !== "function" ||
    typeof durableCore.all !== "function" ||
    typeof durableCore.transaction !== "function" ||
    typeof createAdjudicationId !== "function" ||
    typeof now !== "function" ||
    typeof readCodexCapabilityFailure !== "function" ||
    typeof storageReserve?.assertWorkAdmissionAvailable !== "function"
  ) {
    throw new TypeError(
      "Waiver Adjudication recovery dependencies are invalid",
    );
  }
  return {
    /**
     * @param {{
     *   adjudicationId: string,
     *   channel: "browser_session" | "implementer_token",
     *   idempotencyKey: unknown
     * }} input
     */
    recover({ adjudicationId, channel, idempotencyKey }) {
      if (typeof adjudicationId !== "string" || adjudicationId.length === 0) {
        throw new TypeError("Waiver Adjudication recovery identity is invalid");
      }
      if (channel !== "browser_session") {
        failEvaluation(
          "waiver_adjudication_recovery_forbidden",
          "Only the operator may recover a Waiver Adjudication",
        );
      }
      const key = requireIdempotencyKey(idempotencyKey);
      const route = `/api/v1/waiver-adjudications/${adjudicationId}/recover`;
      const hash = createHash("sha256").update(adjudicationId).digest("hex");
      const replay = readReplay(durableCore, route, key, hash);
      if (replay) {
        return replay;
      }
      const source = readAdjudication(durableCore, adjudicationId);
      if (!source) {
        failEvaluation(
          "waiver_adjudication_not_found",
          "Waiver Adjudication was not found",
        );
      }
      const mode = classifyWaiverAdjudicationRecovery(source);
      const createdAt = now();
      if (!Number.isSafeInteger(createdAt) || createdAt < 0) {
        throw new TypeError("Waiver Adjudication recovery time is invalid");
      }
      storageReserve.assertWorkAdmissionAvailable();
      const capabilityFailure = readCodexCapabilityFailure();
      if (capabilityFailure) {
        throw capabilityFailure;
      }
      return durableCore.transaction((/** @type {any} */ transaction) => {
        const racedReplay = readReplay(transaction, route, key, hash);
        if (racedReplay) {
          return racedReplay;
        }
        const current = readAdjudication(transaction, adjudicationId);
        if (!current) {
          failEvaluation(
            "waiver_adjudication_not_found",
            "Waiver Adjudication was not found",
          );
        }
        if (classifyWaiverAdjudicationRecovery(current) !== mode) {
          failEvaluation(
            "waiver_adjudication_recovery_conflict",
            "Waiver Adjudication recovery state changed",
          );
        }
        assertWaiverRecoveryRepositoryAvailable(
          transaction,
          current.repository_id,
          createdAt,
          mode === "new_adjudication",
        );
        const requests = readRequests(transaction, adjudicationId);
        if (requests.length === 0) {
          throw new TypeError("Waiver Adjudication Requests are invalid");
        }
        const configuration = freezeWaiverAdjudicatorConfiguration(transaction);
        if (mode === "same_identity") {
          validateCodexConfiguration({
            model: current.model,
            reasoning_effort: current.reasoning_effort,
            service_tier: current.service_tier,
          });
          const queuedCount = transaction.get(
            `SELECT count(*) AS count FROM codex_execution_queue
             WHERE started_at IS NULL`,
          )?.count;
          assertReviewRunCapacity(queuedCount, 0);
          if (
            (current.worker_id !== null &&
              (!Number.isSafeInteger(current.lease_expires_at) ||
                current.lease_expires_at > createdAt)) ||
            current.queue_started_at !== null ||
            transaction.run(
              `UPDATE waiver_adjudications
               SET retry_cycle = retry_cycle + 1,
                   pre_start_cycle_attempt_count = 0,
                   pre_start_cycle_retry_error_code = NULL,
                   pre_start_cycle_retry_error_detail = NULL,
                   pre_start_cycle_exhausted_at = NULL
               WHERE id = ? AND execution_status = 'queued'
                 AND started_at IS NULL`,
              adjudicationId,
            ).changes !== 1 ||
            transaction.run(
              `UPDATE codex_execution_queue
               SET ready_at = ?, retry_state = 'ready'
               WHERE work_id = ? AND work_kind = 'waiver_adjudication'
                 AND started_at IS NULL
                 AND retry_state = 'exhausted'
                 AND (
                   worker_id IS NULL
                   OR lease_expires_at <= ?
                 )`,
              createdAt,
              adjudicationId,
              createdAt,
            ).changes !== 1
          ) {
            failEvaluation(
              "waiver_adjudication_recovery_conflict",
              "Waiver Adjudication recovery state changed",
            );
          }
          const updated = {
            ...current,
            execution_status: "queued",
            retry_cycle: current.retry_cycle + 1,
            retry_state: "ready",
          };
          return persistReplay(transaction, {
            createdAt,
            hash,
            key,
            resource: recoveryResource(updated, requests),
            route,
            sourceId: adjudicationId,
            status: 200,
          });
        }
        if (current.decision_count !== 0) {
          failEvaluation(
            "waiver_adjudication_decisions_exist",
            "Failed or cancelled Waiver Adjudication must not contain Decisions",
          );
        }
        assertNoActiveWaiverAdjudication(transaction, current.evaluation_id);
        assertLatestUndecidedRecoverySource(transaction, adjudicationId);
        const recoveredId = createAdjudicationId();
        if (typeof recoveredId !== "string" || recoveredId.length === 0) {
          throw new TypeError(
            "Waiver Adjudication recovery identity is invalid",
          );
        }
        const evaluation = {
          base_commit: current.base_commit,
          head_commit: current.head_commit,
        };
        const resource = queueWaiverAdjudication(transaction, {
          adjudicationId: recoveredId,
          configuration,
          createdAt,
          evaluation,
          evaluationId: current.evaluation_id,
          requestIds: requests.map((/** @type {any} */ request) => request.id),
          writeRequests: () =>
            requests.map((/** @type {any} */ request) => ({
              created_at: new Date(request.created_at).toISOString(),
              evaluation_id: request.evaluation_id,
              finding_id: request.finding_id,
              id: request.id,
              rationale: request.rationale,
            })),
        });
        return persistReplay(transaction, {
          createdAt,
          hash,
          key,
          resource,
          route,
          sourceId: adjudicationId,
          status: 201,
        });
      });
    },
  };
}
