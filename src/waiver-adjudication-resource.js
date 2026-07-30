const timestamp = (/** @type {number} */ value) =>
  new Date(value).toISOString();

/** @param {any} durableCore @param {string} evaluationId */
export function readEvaluationWaiverAdjudications(durableCore, evaluationId) {
  return durableCore
    .all(
      `SELECT waiver_adjudications.*,
              codex_execution_queue.ready_at,
              codex_execution_queue.retry_state,
              (
                SELECT count(*)
                FROM waiver_adjudication_pre_start_attempts
                WHERE waiver_adjudication_id = waiver_adjudications.id
              ) AS pre_start_attempt_count,
              (
                SELECT error_code
                FROM waiver_adjudication_pre_start_attempts
                WHERE waiver_adjudication_id = waiver_adjudications.id
                ORDER BY retry_cycle DESC, attempt_number DESC
                LIMIT 1
              ) AS retry_error_code,
              (
                SELECT error_detail
                FROM waiver_adjudication_pre_start_attempts
                WHERE waiver_adjudication_id = waiver_adjudications.id
                ORDER BY retry_cycle DESC, attempt_number DESC
                LIMIT 1
              ) AS retry_error_detail,
              (
                SELECT failed_at
                FROM waiver_adjudication_pre_start_attempts
                WHERE waiver_adjudication_id = waiver_adjudications.id
                  AND exhausted = 1
                ORDER BY retry_cycle DESC, attempt_number DESC
                LIMIT 1
              ) AS exhausted_at
       FROM waiver_adjudications
       JOIN codex_execution_queue
         ON codex_execution_queue.work_id = waiver_adjudications.id
        AND codex_execution_queue.work_kind = 'waiver_adjudication'
       WHERE waiver_adjudications.evaluation_id = ?
       ORDER BY waiver_adjudications.rowid`,
      evaluationId,
    )
    .map((/** @type {any} */ row) => {
      if (
        typeof row.id !== "string" ||
        !["queued", "running", "completed", "failed", "cancelled"].includes(
          row.execution_status,
        ) ||
        !["ready", "exhausted"].includes(row.retry_state) ||
        !Number.isSafeInteger(row.pre_start_attempt_count) ||
        !Number.isSafeInteger(row.retry_cycle) ||
        (row.retry_state === "exhausted" &&
          !Number.isSafeInteger(row.exhausted_at))
      ) {
        throw new TypeError("Waiver Adjudication resource is invalid");
      }
      const decisions = durableCore
        .all(
          `SELECT id, waiver_request_id, outcome, explanation,
                  error_code, error_detail
           FROM waiver_decisions
           WHERE waiver_adjudication_id = ?
           ORDER BY rowid`,
          row.id,
        )
        .map((/** @type {any} */ decision) => ({
          ...(decision.outcome === "error"
            ? {
                error: {
                  code: decision.error_code,
                  detail: decision.error_detail,
                },
              }
            : { explanation: decision.explanation }),
          id: decision.id,
          outcome: decision.outcome,
          request_id: decision.waiver_request_id,
        }));
      const requestIds = durableCore
        .all(
          `SELECT waiver_request_id
           FROM waiver_adjudication_requests
           WHERE waiver_adjudication_id = ?
           ORDER BY position`,
          row.id,
        )
        .map((/** @type {any} */ request) => request.waiver_request_id);
      return {
        completed_at:
          row.completed_at === null ? null : timestamp(row.completed_at),
        decisions,
        ...(row.execution_status === "failed"
          ? {
              error: {
                code: row.error_code,
                detail: row.error_detail,
              },
            }
          : {}),
        execution_status: row.execution_status,
        exhausted_at:
          row.retry_state === "exhausted" ? timestamp(row.exhausted_at) : null,
        id: row.id,
        next_attempt_at:
          row.execution_status === "queued" && row.retry_state === "ready"
            ? timestamp(row.ready_at)
            : null,
        pre_start_attempt_count: row.pre_start_attempt_count,
        request_ids: requestIds,
        retry_cycle: row.retry_cycle,
        retry_error:
          row.retry_error_code === null
            ? null
            : {
                code: row.retry_error_code,
                detail: row.retry_error_detail,
              },
        retry_state: row.retry_state,
        started_at: row.started_at === null ? null : timestamp(row.started_at),
      };
    });
}
