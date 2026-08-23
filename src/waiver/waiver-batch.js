import { createHash, randomUUID } from "node:crypto";
import {
  failEvaluation,
  requireIdempotencyKey,
} from "../evaluation/evaluation-validation.js";
import { freezeWaiverAdjudicatorConfiguration } from "./waiver-adjudicator-configuration.js";
import {
  assertNoActiveWaiverAdjudication,
  persistQueuedWaiverAdjudication,
  readWaiverEvaluation,
  readWaiverReplay,
} from "./waiver-adjudication-persistence.js";
import { createWaiverErrorRetryService } from "./waiver-error-retry.js";
import { createWaiverAdjudicationRecoveryService } from "./waiver-adjudication-recovery.js";
import { waiverRequestNextAction } from "./waiver-request-lifecycle.js";

export { canonicalWaiverErrorRetryRequest } from "./waiver-error-retry.js";

function invalidBatch() {
  failEvaluation(
    "waiver_batch_invalid",
    "Waiver batch must contain unique Findings with nonblank rationales",
  );
}

/** @param {unknown} candidate */
export function canonicalWaiverBatchRequest(candidate) {
  const input = /** @type {any} */ (candidate);
  if (
    !candidate ||
    typeof candidate !== "object" ||
    Array.isArray(candidate) ||
    Object.keys(input).length !== 1 ||
    !Array.isArray(input.requests) ||
    input.requests.length === 0
  ) {
    invalidBatch();
  }
  const seen = new Set();
  const requests = input.requests.map((/** @type {any} */ request) => {
    if (
      !request ||
      typeof request !== "object" ||
      Array.isArray(request) ||
      Object.keys(request).length !== 2 ||
      Object.keys(request).some(
        (key) => !["finding_id", "rationale"].includes(key),
      ) ||
      typeof request.finding_id !== "string" ||
      request.finding_id.length === 0 ||
      typeof request.rationale !== "string" ||
      request.rationale.trim().length === 0 ||
      seen.has(request.finding_id)
    ) {
      invalidBatch();
    }
    seen.add(request.finding_id);
    return {
      finding_id: request.finding_id,
      rationale: request.rationale.trim(),
    };
  });
  requests.sort(
    (
      /** @type {{finding_id: string}} */ left,
      /** @type {{finding_id: string}} */ right,
    ) => left.finding_id.localeCompare(right.finding_id),
  );
  return { requests };
}

/**
 * @param {any} durableCore
 * @param {{
 *   createAdjudicationId?: () => string,
 *   createRequestId?: () => string,
 *   now?: () => number,
 *   readCodexCapabilityFailure: () => (Error & {code: string, unavailable?: boolean}) | null,
 *   storageReserve: {assertWorkAdmissionAvailable: () => unknown}
 * }} options
 */
export function createWaiverBatchService(
  durableCore,
  {
    createAdjudicationId = () => randomUUID(),
    createRequestId = () => randomUUID(),
    now = () => Date.now(),
    readCodexCapabilityFailure,
    storageReserve,
  },
) {
  if (
    typeof durableCore?.get !== "function" ||
    typeof durableCore.transaction !== "function" ||
    typeof createAdjudicationId !== "function" ||
    typeof createRequestId !== "function" ||
    typeof now !== "function" ||
    typeof readCodexCapabilityFailure !== "function" ||
    typeof storageReserve?.assertWorkAdmissionAvailable !== "function"
  ) {
    throw new TypeError("Waiver batch dependencies are invalid");
  }
  const errorRetries = createWaiverErrorRetryService(durableCore, {
    createAdjudicationId,
    now,
    readCodexCapabilityFailure,
    storageReserve,
  });
  const recoveries = createWaiverAdjudicationRecoveryService(durableCore, {
    createAdjudicationId,
    now,
    readCodexCapabilityFailure,
    storageReserve,
  });
  return {
    recoverAdjudication: recoveries.recover,
    retryErrors: errorRetries.retry,
    /**
     * @param {{
     *   channel: "browser_session" | "implementer_token" | "mcp",
     *   evaluationId: string,
     *   idempotencyKey: unknown,
     *   request: unknown
     * }} input
     */
    submit({ channel, evaluationId, idempotencyKey, request }) {
      if (
        !["browser_session", "implementer_token", "mcp"].includes(channel) ||
        typeof evaluationId !== "string" ||
        evaluationId.length === 0
      ) {
        throw new TypeError("Waiver batch identity is invalid");
      }
      const key = requireIdempotencyKey(idempotencyKey);
      const canonical = canonicalWaiverBatchRequest(request);
      const persistenceChannel =
        channel === "mcp" ? "implementer_token" : channel;
      const route =
        channel === "mcp"
          ? "quality_bar.submit_waiver_requests"
          : `/api/v1/evaluations/${evaluationId}/waiver-adjudications`;
      const hash = createHash("sha256")
        .update(JSON.stringify(canonical))
        .digest("hex");
      const replay = readWaiverReplay(durableCore, {
        channel: persistenceChannel,
        hash,
        key,
        route,
      });
      if (replay) {
        return replay;
      }
      storageReserve.assertWorkAdmissionAvailable();
      const capabilityFailure = readCodexCapabilityFailure();
      if (capabilityFailure) {
        throw capabilityFailure;
      }
      const createdAt = now();
      const adjudicationId = createAdjudicationId();
      const requestIds = canonical.requests.map(() => createRequestId());
      if (
        !Number.isSafeInteger(createdAt) ||
        typeof adjudicationId !== "string" ||
        adjudicationId.length === 0 ||
        requestIds.some(
          (/** @type {unknown} */ id) =>
            typeof id !== "string" || id.length === 0,
        )
      ) {
        throw new TypeError("Waiver batch identity or timestamp is invalid");
      }
      return durableCore.transaction((/** @type {any} */ transaction) => {
        const racedReplay = readWaiverReplay(transaction, {
          channel: persistenceChannel,
          hash,
          key,
          route,
        });
        if (racedReplay) {
          return racedReplay;
        }
        const evaluation = readWaiverEvaluation(transaction, evaluationId);
        assertNoActiveWaiverAdjudication(transaction, evaluationId);
        const configuration = freezeWaiverAdjudicatorConfiguration(transaction);
        const findings = transaction.all(
          `SELECT findings.id, findings.evaluation_id,
                  review_version_criteria.impact,
                  (SELECT count(*) FROM waiver_requests
                   WHERE waiver_requests.finding_id = findings.id) AS request_count,
                  (
                    SELECT count(*)
                    FROM waiver_requests AS accepted_request
                    WHERE accepted_request.finding_id = findings.id
                      AND (
                        SELECT waiver_decisions.outcome
                        FROM waiver_decisions
                        JOIN waiver_adjudications
                          ON waiver_adjudications.id =
                               waiver_decisions.waiver_adjudication_id
                        WHERE waiver_decisions.waiver_request_id =
                                accepted_request.id
                        ORDER BY waiver_adjudications.rowid DESC
                        LIMIT 1
                      ) = 'accepted'
                  ) AS accepted_request_count,
                  (
                    SELECT waiver_decisions.outcome
                    FROM waiver_requests AS latest_request
                    JOIN waiver_decisions
                      ON waiver_decisions.waiver_request_id = latest_request.id
                    JOIN waiver_adjudications
                      ON waiver_adjudications.id =
                           waiver_decisions.waiver_adjudication_id
                    WHERE latest_request.id = (
                      SELECT waiver_requests.id
                      FROM waiver_requests
                      WHERE waiver_requests.finding_id = findings.id
                      ORDER BY waiver_requests.rowid DESC
                      LIMIT 1
                    )
                    ORDER BY waiver_adjudications.rowid DESC
                    LIMIT 1
                  ) AS latest_decision
           FROM findings
           JOIN review_runs ON review_runs.id = findings.review_run_id
           JOIN review_version_criteria
             ON review_version_criteria.review_version_id = review_runs.review_version_id
            AND review_version_criteria.criterion_id = findings.criterion_id
           WHERE findings.id IN (${canonical.requests.map(() => "?").join(",")})`,
          ...canonical.requests.map(
            (/** @type {{finding_id: string}} */ { finding_id }) => finding_id,
          ),
        );
        const byId = new Map(
          findings.map((/** @type {any} */ finding) => [finding.id, finding]),
        );
        const priorRationales = new Set(
          transaction
            .all(
              `SELECT finding_id, rationale FROM waiver_requests
               WHERE finding_id IN (${canonical.requests.map(() => "?").join(",")})`,
              ...canonical.requests.map(
                (/** @type {{finding_id: string}} */ { finding_id }) =>
                  finding_id,
              ),
            )
            .map(
              (/** @type {any} */ prior) =>
                `${prior.finding_id}\u0000${prior.rationale}`,
            ),
        );
        for (const requestValue of canonical.requests) {
          const finding = byId.get(requestValue.finding_id);
          if (!finding) {
            failEvaluation("finding_not_found", "Finding was not found");
          }
          if (finding.evaluation_id !== evaluationId) {
            failEvaluation(
              "waiver_cross_evaluation",
              "Every Finding must belong to the addressed Evaluation",
            );
          }
          if (finding.impact !== "advisory") {
            failEvaluation(
              "waiver_finding_ineligible",
              "Only advisory Findings are eligible for waiver",
            );
          }
          const nextAction = waiverRequestNextAction({
            acceptedRequestCount: finding.accepted_request_count,
            latestDecision: finding.latest_decision,
            requestCount: finding.request_count,
          });
          if (nextAction === "accepted") {
            failEvaluation(
              "waiver_request_accepted",
              "Finding already has an accepted Waiver Request",
            );
          }
          if (nextAction === "retry_error") {
            failEvaluation(
              "waiver_request_error_retry_required",
              "Finding's errored Waiver Request must be retried without creating another Request",
            );
          }
          if (nextAction === "decision_required") {
            failEvaluation(
              "waiver_request_decision_required",
              "Finding's latest Waiver Request has no Decision",
            );
          }
          if (nextAction === "limit_reached") {
            failEvaluation(
              "waiver_request_limit_reached",
              "Finding has reached its Waiver Request limit",
            );
          }
          if (
            priorRationales.has(
              `${requestValue.finding_id}\u0000${requestValue.rationale}`,
            )
          ) {
            failEvaluation(
              "waiver_request_duplicate",
              "Finding already has a Waiver Request with this rationale",
            );
          }
        }
        return persistQueuedWaiverAdjudication(transaction, {
          adjudicationId,
          channel: persistenceChannel,
          configuration,
          createdAt,
          evaluation,
          evaluationId,
          hash,
          key,
          requestIds,
          route,
          writeRequests: () =>
            canonical.requests.map(
              (
                /** @type {any} */ requestValue,
                /** @type {number} */ index,
              ) => {
                const id = requestIds[index];
                transaction.run(
                  `INSERT INTO waiver_requests (
                     id, evaluation_id, finding_id, rationale,
                     requester_channel, created_at
                   ) VALUES (?, ?, ?, ?, ?, ?)`,
                  id,
                  evaluationId,
                  requestValue.finding_id,
                  requestValue.rationale,
                  persistenceChannel,
                  createdAt,
                );
                return {
                  created_at: new Date(createdAt).toISOString(),
                  evaluation_id: evaluationId,
                  finding_id: requestValue.finding_id,
                  id,
                  rationale: requestValue.rationale,
                };
              },
            ),
        });
      });
    },
  };
}
