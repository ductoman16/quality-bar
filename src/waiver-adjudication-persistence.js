import { failEvaluation } from "./evaluation-validation.js";
import { assertReviewRunCapacity } from "./review-run-admission.js";

/** @param {number} value */
const timestamp = (value) => new Date(value).toISOString();

/**
 * @param {any} access
 * @param {{channel: string, hash: string, key: string, route: string}} identity
 */
export function readWaiverReplay(access, { channel, hash, key, route }) {
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

/** @param {any} transaction @param {string} evaluationId */
export function readWaiverEvaluation(transaction, evaluationId) {
  const evaluation = transaction.get(
    `SELECT evaluations.base_commit, evaluations.head_commit,
            evaluation_results.evaluation_id
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
  return evaluation;
}

/** @param {any} transaction @param {string} evaluationId */
export function assertNoActiveWaiverAdjudication(transaction, evaluationId) {
  const active = transaction.get(
    `SELECT id, execution_status FROM waiver_adjudications
     WHERE evaluation_id = ?
       AND execution_status IN ('queued', 'running')`,
    evaluationId,
  );
  if (active) {
    failEvaluation(
      "waiver_adjudication_active",
      `Waiver Adjudication ${active.id} is ${active.execution_status}`,
    );
  }
}

/**
 * @param {any} transaction
 * @param {{
 *   adjudicationId: string,
 *   channel: "browser_session" | "implementer_token",
 *   configuration: {model: string, reasoning_effort: string, service_tier: string},
 *   createdAt: number,
 *   evaluation: {base_commit: string, head_commit: string},
 *   evaluationId: string,
 *   hash: string,
 *   key: string,
 *   requestIds: string[],
 *   route: string,
 *   writeRequests: () => Array<{
 *     created_at: string,
 *     evaluation_id: string,
 *     finding_id: string,
 *     id: string,
 *     rationale: string
 *   }>
 * }} input
 */
export function persistQueuedWaiverAdjudication(transaction, input) {
  const queued = transaction.get(
    "SELECT count(*) AS count FROM codex_execution_queue WHERE started_at IS NULL",
  )?.count;
  assertReviewRunCapacity(queued, 1);
  transaction.run(
    `INSERT INTO waiver_adjudications (
       id, evaluation_id, base_commit, head_commit, model,
       reasoning_effort, service_tier, execution_status, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?)`,
    input.adjudicationId,
    input.evaluationId,
    input.evaluation.base_commit,
    input.evaluation.head_commit,
    input.configuration.model,
    input.configuration.reasoning_effort,
    input.configuration.service_tier,
    input.createdAt,
  );
  const requests = input.writeRequests();
  for (const [index, requestId] of input.requestIds.entries()) {
    transaction.run(
      `INSERT INTO waiver_adjudication_requests (
         waiver_adjudication_id, waiver_request_id, position
       ) VALUES (?, ?, ?)`,
      input.adjudicationId,
      requestId,
      index + 1,
    );
  }
  transaction.run(
    `INSERT INTO codex_execution_queue (
       work_id, work_kind, ready_at, accepted_at, started_at
     ) VALUES (?, 'waiver_adjudication', ?, ?, NULL)`,
    input.adjudicationId,
    input.createdAt,
    input.createdAt,
  );
  const adjudication = {
    base_commit: input.evaluation.base_commit,
    configuration: {
      model: input.configuration.model,
      reasoning_effort: input.configuration.reasoning_effort,
      service_tier: input.configuration.service_tier,
    },
    created_at: timestamp(input.createdAt),
    evaluation_id: input.evaluationId,
    execution_status: "queued",
    head_commit: input.evaluation.head_commit,
    id: input.adjudicationId,
    request_ids: input.requestIds,
  };
  const resource = { adjudication, requests };
  transaction.run(
    `INSERT INTO waiver_batch_idempotency (
       channel, route, idempotency_key, request_hash, response_status,
       response_body, waiver_adjudication_id, created_at
     ) VALUES (?, ?, ?, ?, 201, ?, ?, ?)`,
    input.channel,
    input.route,
    input.key,
    input.hash,
    JSON.stringify(resource),
    input.adjudicationId,
    input.createdAt,
  );
  return { resource, status: 201 };
}
