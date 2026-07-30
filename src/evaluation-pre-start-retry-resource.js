const timestamp = (/** @type {number} */ value) =>
  new Date(value).toISOString();

/** @param {Record<string, import("node:sqlite").SQLInputValue>} row */
export function validEvaluationPreStartRetryRow(row) {
  return (
    ["ready", "exhausted"].includes(String(row.pre_start_retry_state)) &&
    Number.isSafeInteger(row.pre_start_attempt_count)
  );
}

/** @param {Record<string, import("node:sqlite").SQLInputValue>} row */
export function readEvaluationPreStartRetry(row) {
  return {
    exhausted_at:
      row.pre_start_exhausted_at === null
        ? null
        : timestamp(/** @type {number} */ (row.pre_start_exhausted_at)),
    next_attempt_at:
      row.pre_start_next_attempt_at === null && row.next_attempt_at === null
        ? null
        : timestamp(
            /** @type {number} */ (
              row.pre_start_next_attempt_at ?? row.next_attempt_at
            ),
          ),
    pre_start_attempt_count: row.pre_start_attempt_count,
    retry_error:
      row.pre_start_retry_error_code === null
        ? null
        : {
            code: row.pre_start_retry_error_code,
            detail: row.pre_start_retry_error_detail,
          },
    retry_state: row.pre_start_retry_state,
  };
}

export const EVALUATION_PRE_START_RETRY_SELECTION = `
  CASE WHEN EXISTS (
    SELECT 1 FROM review_runs AS retry_run
    JOIN codex_execution_queue AS retry_queue
      ON retry_queue.work_id = retry_run.id
     AND retry_queue.work_kind = 'review_run'
    WHERE retry_run.evaluation_id = evaluations.id
      AND retry_queue.retry_state = 'exhausted'
  ) THEN 'exhausted' ELSE 'ready' END AS pre_start_retry_state,
  (SELECT count(*) FROM review_run_pre_start_attempts AS retry_attempt
   JOIN review_runs AS retry_attempt_run
     ON retry_attempt_run.id = retry_attempt.review_run_id
   WHERE retry_attempt_run.evaluation_id = evaluations.id
  ) AS pre_start_attempt_count,
  (SELECT retry_attempt.failed_at FROM review_run_pre_start_attempts AS retry_attempt
   JOIN review_runs AS retry_attempt_run
     ON retry_attempt_run.id = retry_attempt.review_run_id
   WHERE retry_attempt_run.evaluation_id = evaluations.id
     AND retry_attempt.exhausted = 1
   ORDER BY retry_attempt.failed_at DESC, retry_attempt.review_run_id DESC,
            retry_attempt.retry_cycle DESC, retry_attempt.attempt_number DESC
   LIMIT 1
  ) AS pre_start_exhausted_at,
  (SELECT retry_attempt.error_code FROM review_run_pre_start_attempts AS retry_attempt
   JOIN review_runs AS retry_attempt_run
     ON retry_attempt_run.id = retry_attempt.review_run_id
   WHERE retry_attempt_run.evaluation_id = evaluations.id
     AND (
       NOT EXISTS (
         SELECT 1 FROM review_runs AS exhausted_error_run
         JOIN codex_execution_queue AS exhausted_error_queue
           ON exhausted_error_queue.work_id = exhausted_error_run.id
          AND exhausted_error_queue.work_kind = 'review_run'
         WHERE exhausted_error_run.evaluation_id = evaluations.id
           AND exhausted_error_queue.retry_state = 'exhausted'
       )
       OR retry_attempt.exhausted = 1
     )
   ORDER BY retry_attempt.failed_at DESC, retry_attempt.review_run_id DESC,
            retry_attempt.retry_cycle DESC, retry_attempt.attempt_number DESC
   LIMIT 1
  ) AS pre_start_retry_error_code,
  (SELECT retry_attempt.error_detail FROM review_run_pre_start_attempts AS retry_attempt
   JOIN review_runs AS retry_attempt_run
     ON retry_attempt_run.id = retry_attempt.review_run_id
   WHERE retry_attempt_run.evaluation_id = evaluations.id
     AND (
       NOT EXISTS (
         SELECT 1 FROM review_runs AS exhausted_error_run
         JOIN codex_execution_queue AS exhausted_error_queue
           ON exhausted_error_queue.work_id = exhausted_error_run.id
          AND exhausted_error_queue.work_kind = 'review_run'
         WHERE exhausted_error_run.evaluation_id = evaluations.id
           AND exhausted_error_queue.retry_state = 'exhausted'
       )
       OR retry_attempt.exhausted = 1
     )
   ORDER BY retry_attempt.failed_at DESC, retry_attempt.review_run_id DESC,
            retry_attempt.retry_cycle DESC, retry_attempt.attempt_number DESC
   LIMIT 1
  ) AS pre_start_retry_error_detail,
  CASE WHEN NOT EXISTS (
    SELECT 1 FROM review_run_pre_start_attempts AS any_retry_attempt
    JOIN review_runs AS any_retry_run
      ON any_retry_run.id = any_retry_attempt.review_run_id
    WHERE any_retry_run.evaluation_id = evaluations.id
  ) OR EXISTS (
    SELECT 1 FROM review_runs AS exhausted_run
    JOIN codex_execution_queue AS exhausted_queue
      ON exhausted_queue.work_id = exhausted_run.id
     AND exhausted_queue.work_kind = 'review_run'
    WHERE exhausted_run.evaluation_id = evaluations.id
      AND exhausted_queue.retry_state = 'exhausted'
  ) THEN NULL ELSE (
    SELECT MIN(ready_queue.ready_at)
    FROM review_runs AS ready_run
    JOIN codex_execution_queue AS ready_queue
      ON ready_queue.work_id = ready_run.id
     AND ready_queue.work_kind = 'review_run'
    WHERE ready_run.evaluation_id = evaluations.id
      AND ready_run.execution_status = 'queued'
      AND ready_queue.started_at IS NULL
      AND ready_queue.retry_state = 'ready'
  ) END AS pre_start_next_attempt_at,`;
