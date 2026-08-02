const timestamp = (/** @type {number} */ value) =>
  new Date(value).toISOString();

/** @param {any} row */
function latestAttempt(row) {
  if (row.attempt_count === null) {
    return null;
  }
  if (
    !Number.isSafeInteger(row.attempt_count) ||
    row.attempt_count < 0 ||
    !(
      row.last_attempt_at === null || Number.isSafeInteger(row.last_attempt_at)
    ) ||
    !Number.isSafeInteger(row.delivery_next_attempt_at) ||
    ![0, 1].includes(row.reconciliation_required)
  ) {
    throw new TypeError("Waiver follow-up delivery attempt is invalid");
  }
  return {
    attempt_count: row.attempt_count,
    error:
      row.delivery_error_code === null
        ? null
        : {
            code: row.delivery_error_code,
            detail: row.delivery_error_detail,
          },
    last_attempt_at:
      row.last_attempt_at === null ? null : timestamp(row.last_attempt_at),
    next_attempt_at:
      row.delivery_next_attempt_at === 0
        ? null
        : timestamp(row.delivery_next_attempt_at),
    reconciliation_required: row.reconciliation_required === 1,
  };
}

/** @param {any} durableCore @param {string} evaluationId */
export function readEvaluationWaiverAdjudications(durableCore, evaluationId) {
  return durableCore
    .all(
      `SELECT waiver_adjudications.*,
              codex_execution_queue.ready_at,
              codex_execution_queue.retry_state,
              waiver_adjudications.pre_start_attempt_count,
              waiver_adjudications.pre_start_retry_error_code AS retry_error_code,
              waiver_adjudications.pre_start_retry_error_detail AS retry_error_detail,
              waiver_adjudications.pre_start_exhausted_at AS exhausted_at,
              COALESCE(github_followup.publication_status,
                       forgejo_followup.publication_status) AS followup_status,
              COALESCE(github_followup.error_code,
                       forgejo_followup.error_code) AS followup_error_code,
              COALESCE(github_followup.error_detail,
                       forgejo_followup.error_detail) AS followup_error_detail
              ,COALESCE(github_attempt.attempt_count,
                        forgejo_attempt.attempt_count) AS attempt_count
              ,COALESCE(github_attempt.last_attempt_at,
                        forgejo_attempt.last_attempt_at) AS last_attempt_at
              ,COALESCE(github_attempt.next_attempt_at,
                        forgejo_attempt.next_attempt_at) AS delivery_next_attempt_at
              ,COALESCE(github_attempt.reconciliation_required,
                        forgejo_attempt.reconciliation_required) AS reconciliation_required
              ,COALESCE(github_attempt.error_code,
                        forgejo_attempt.error_code) AS delivery_error_code
              ,COALESCE(github_attempt.error_detail,
                        forgejo_attempt.error_detail) AS delivery_error_detail
       FROM waiver_adjudications
       JOIN codex_execution_queue
         ON codex_execution_queue.work_id = waiver_adjudications.id
        AND codex_execution_queue.work_kind = 'waiver_adjudication'
       LEFT JOIN github_waiver_adjudication_followups AS github_followup
         ON github_followup.waiver_adjudication_id = waiver_adjudications.id
       LEFT JOIN forgejo_waiver_adjudication_followups AS forgejo_followup
         ON forgejo_followup.waiver_adjudication_id = waiver_adjudications.id
       LEFT JOIN github_delivery_attempts AS github_attempt
         ON github_attempt.surface = 'aggregate_feedback'
        AND github_attempt.source_id =
              'waiver-adjudication:' || waiver_adjudications.id
       LEFT JOIN forgejo_delivery_attempts AS forgejo_attempt
         ON forgejo_attempt.surface = 'aggregate_feedback'
        AND forgejo_attempt.source_id =
              'waiver-adjudication:' || waiver_adjudications.id
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
      const localFollowups = durableCore.all(
        `SELECT local.waiver_decision_id, local.publication_status,
                local.error_code, local.error_detail,
                attempts.attempt_count, attempts.last_attempt_at,
                attempts.next_attempt_at AS delivery_next_attempt_at,
                attempts.reconciliation_required,
                attempts.error_code AS delivery_error_code,
                attempts.error_detail AS delivery_error_detail
         FROM github_waiver_decision_followups AS local
         LEFT JOIN github_delivery_attempts AS attempts
           ON attempts.surface = 'inline_feedback'
          AND attempts.source_id = 'waiver-decision:' ||
               local.waiver_decision_id || ':' || local.finding_id
         WHERE local.waiver_adjudication_id = ?
         UNION ALL
         SELECT local.waiver_decision_id, local.publication_status,
                local.error_code, local.error_detail,
                attempts.attempt_count, attempts.last_attempt_at,
                attempts.next_attempt_at AS delivery_next_attempt_at,
                attempts.reconciliation_required,
                attempts.error_code AS delivery_error_code,
                attempts.error_detail AS delivery_error_detail
         FROM forgejo_waiver_decision_followups AS local
         LEFT JOIN forgejo_delivery_attempts AS attempts
           ON attempts.surface = 'inline_feedback'
          AND attempts.source_id = 'waiver-decision:' ||
               local.waiver_decision_id || ':' || local.finding_id
         WHERE local.waiver_adjudication_id = ?
         ORDER BY waiver_decision_id`,
        row.id,
        row.id,
      );
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
        followup:
          row.followup_status === null
            ? null
            : {
                aggregate: {
                  error:
                    (row.followup_error_code ?? row.delivery_error_code) ===
                    null
                      ? null
                      : {
                          code:
                            row.followup_error_code ?? row.delivery_error_code,
                          detail:
                            row.followup_error_detail ??
                            row.delivery_error_detail,
                        },
                  latest_attempt: latestAttempt(row),
                  publication_status: row.followup_status,
                },
                local: localFollowups.map((/** @type {any} */ local) => ({
                  decision_id: local.waiver_decision_id,
                  error:
                    (local.error_code ?? local.delivery_error_code) === null
                      ? null
                      : {
                          code: local.error_code ?? local.delivery_error_code,
                          detail:
                            local.error_detail ?? local.delivery_error_detail,
                        },
                  latest_attempt: latestAttempt(local),
                  publication_status: local.publication_status,
                })),
              },
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
