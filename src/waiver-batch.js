import { createHash, randomUUID } from "node:crypto";
import {
  failEvaluation,
  requireIdempotencyKey,
} from "./evaluation-validation.js";
import { assertReviewRunCapacity } from "./review-run-admission.js";
import { freezeWaiverAdjudicatorConfiguration } from "./waiver-adjudicator-configuration.js";

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

/** @param {number} value */
const timestamp = (value) => new Date(value).toISOString();

/**
 * @param {any} access
 * @param {string} channel
 * @param {string} route
 * @param {string} key
 * @param {string} hash
 */
function readReplay(access, channel, route, key, hash) {
  const row = access.get(
    `SELECT request_hash, response_status, response_body
     FROM waiver_batch_idempotency
     WHERE channel = ? AND route = ? AND idempotency_key = ?`,
    channel,
    route,
    key,
  );
  if (!row) {
    return null;
  }
  if (row.request_hash !== hash) {
    failEvaluation(
      "idempotency_conflict",
      "Idempotency key was already used with different input",
    );
  }
  return {
    resource: JSON.parse(row.response_body),
    status: row.response_status,
  };
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
  return {
    /**
     * @param {{
     *   channel: "browser_session" | "implementer_token",
     *   evaluationId: string,
     *   idempotencyKey: unknown,
     *   request: unknown
     * }} input
     */
    submit({ channel, evaluationId, idempotencyKey, request }) {
      if (
        !["browser_session", "implementer_token"].includes(channel) ||
        typeof evaluationId !== "string" ||
        evaluationId.length === 0
      ) {
        throw new TypeError("Waiver batch identity is invalid");
      }
      const key = requireIdempotencyKey(idempotencyKey);
      const canonical = canonicalWaiverBatchRequest(request);
      const route = `/api/v1/evaluations/${evaluationId}/waiver-adjudications`;
      const hash = createHash("sha256")
        .update(JSON.stringify(canonical))
        .digest("hex");
      const replay = readReplay(durableCore, channel, route, key, hash);
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
        const racedReplay = readReplay(transaction, channel, route, key, hash);
        if (racedReplay) {
          return racedReplay;
        }
        const evaluation = transaction.get(
          `SELECT evaluations.base_commit, evaluations.head_commit,
                  evaluations.execution_status, evaluation_results.evaluation_id
           FROM evaluations
           LEFT JOIN evaluation_results
             ON evaluation_results.evaluation_id = evaluations.id
           WHERE evaluations.id = ?`,
          evaluationId,
        );
        if (!evaluation) {
          failEvaluation("evaluation_not_found", "Evaluation was not found");
        }
        if (evaluation.evaluation_id !== evaluationId) {
          failEvaluation(
            "evaluation_result_not_ready",
            "Evaluation Result is not ready",
          );
        }
        const activeAdjudication = transaction.get(
          `SELECT id, execution_status FROM waiver_adjudications
             WHERE evaluation_id = ?
               AND execution_status IN ('queued', 'running')`,
          evaluationId,
        );
        if (activeAdjudication) {
          failEvaluation(
            "waiver_adjudication_active",
            `Waiver Adjudication ${activeAdjudication.id} is ${activeAdjudication.execution_status}`,
          );
        }
        const configuration = freezeWaiverAdjudicatorConfiguration(transaction);
        const findings = transaction.all(
          `SELECT findings.id, findings.evaluation_id,
                  review_version_criteria.impact,
                  (SELECT count(*) FROM waiver_requests
                   WHERE waiver_requests.finding_id = findings.id) AS request_count
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
          if (finding.request_count >= 3) {
            failEvaluation(
              "waiver_request_limit_reached",
              "Finding has reached its Waiver Request limit",
            );
          }
        }
        const queued = transaction.get(
          "SELECT count(*) AS count FROM codex_execution_queue WHERE started_at IS NULL",
        )?.count;
        assertReviewRunCapacity(queued, 1);
        transaction.run(
          `INSERT INTO waiver_adjudications (
             id, evaluation_id, base_commit, head_commit, model,
             reasoning_effort, service_tier, execution_status, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?)`,
          adjudicationId,
          evaluationId,
          evaluation.base_commit,
          evaluation.head_commit,
          configuration.model,
          configuration.reasoning_effort,
          configuration.service_tier,
          createdAt,
        );
        const requests = canonical.requests.map(
          (/** @type {any} */ requestValue, /** @type {number} */ index) => {
            const id = requestIds[index];
            transaction.run(
              `INSERT INTO waiver_requests (
               id, evaluation_id, finding_id, rationale, requester_channel, created_at
             ) VALUES (?, ?, ?, ?, ?, ?)`,
              id,
              evaluationId,
              requestValue.finding_id,
              requestValue.rationale,
              channel,
              createdAt,
            );
            transaction.run(
              `INSERT INTO waiver_adjudication_requests (
               waiver_adjudication_id, waiver_request_id, position
             ) VALUES (?, ?, ?)`,
              adjudicationId,
              id,
              index + 1,
            );
            return {
              created_at: timestamp(createdAt),
              evaluation_id: evaluationId,
              finding_id: requestValue.finding_id,
              id,
              rationale: requestValue.rationale,
            };
          },
        );
        transaction.run(
          `INSERT INTO codex_execution_queue (
             work_id, work_kind, ready_at, accepted_at, started_at
           ) VALUES (?, 'waiver_adjudication', ?, ?, NULL)`,
          adjudicationId,
          createdAt,
          createdAt,
        );
        const adjudication = {
          base_commit: evaluation.base_commit,
          configuration: {
            model: configuration.model,
            reasoning_effort: configuration.reasoning_effort,
            service_tier: configuration.service_tier,
          },
          created_at: timestamp(createdAt),
          evaluation_id: evaluationId,
          execution_status: "queued",
          head_commit: evaluation.head_commit,
          id: adjudicationId,
          request_ids: requestIds,
        };
        const resource = { adjudication, requests };
        transaction.run(
          `INSERT INTO waiver_batch_idempotency (
             channel, route, idempotency_key, request_hash, response_status,
             response_body, waiver_adjudication_id, created_at
           ) VALUES (?, ?, ?, ?, 201, ?, ?, ?)`,
          channel,
          route,
          key,
          hash,
          JSON.stringify(resource),
          adjudicationId,
          createdAt,
        );
        return { resource, status: 201 };
      });
    },
  };
}
