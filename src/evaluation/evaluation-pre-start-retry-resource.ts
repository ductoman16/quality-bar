const timestamp = (value: number) => new Date(value).toISOString();

export function validEvaluationPreStartRetryRow(
  row: Record<string, import("node:sqlite").SQLInputValue>,
) {
  return (
    ["ready", "exhausted"].includes(String(row.pre_start_retry_state)) &&
    Number.isSafeInteger(row.pre_start_attempt_count)
  );
}

export function readEvaluationPreStartRetry(
  row: Record<string, import("node:sqlite").SQLInputValue>,
) {
  return {
    exhausted_at:
      row.pre_start_exhausted_at === null
        ? null
        : timestamp(row.pre_start_exhausted_at as number),
    next_attempt_at:
      row.pre_start_next_attempt_at === null && row.next_attempt_at === null
        ? null
        : timestamp(
            (row.pre_start_next_attempt_at ?? row.next_attempt_at) as number,
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
  COALESCE((SELECT sum(retry_run.pre_start_attempt_count)
            FROM review_runs AS retry_run
            WHERE retry_run.evaluation_id = evaluations.id), 0)
    AS pre_start_attempt_count,
  (SELECT max(retry_run.pre_start_exhausted_at)
   FROM review_runs AS retry_run
   WHERE retry_run.evaluation_id = evaluations.id
  ) AS pre_start_exhausted_at,
  (SELECT retry_run.pre_start_retry_error_code
   FROM review_runs AS retry_run
   WHERE retry_run.evaluation_id = evaluations.id
     AND (
       NOT EXISTS (
         SELECT 1 FROM review_runs AS exhausted_error_run
         JOIN codex_execution_queue AS exhausted_error_queue
           ON exhausted_error_queue.work_id = exhausted_error_run.id
          AND exhausted_error_queue.work_kind = 'review_run'
         WHERE exhausted_error_run.evaluation_id = evaluations.id
           AND exhausted_error_queue.retry_state = 'exhausted'
       )
       OR retry_run.pre_start_cycle_exhausted_at IS NOT NULL
     )
   ORDER BY retry_run.pre_start_last_attempt_at DESC, retry_run.id DESC
   LIMIT 1
  ) AS pre_start_retry_error_code,
  (SELECT retry_run.pre_start_retry_error_detail
   FROM review_runs AS retry_run
   WHERE retry_run.evaluation_id = evaluations.id
     AND (
       NOT EXISTS (
         SELECT 1 FROM review_runs AS exhausted_error_run
         JOIN codex_execution_queue AS exhausted_error_queue
           ON exhausted_error_queue.work_id = exhausted_error_run.id
          AND exhausted_error_queue.work_kind = 'review_run'
         WHERE exhausted_error_run.evaluation_id = evaluations.id
           AND exhausted_error_queue.retry_state = 'exhausted'
       )
       OR retry_run.pre_start_cycle_exhausted_at IS NOT NULL
     )
   ORDER BY retry_run.pre_start_last_attempt_at DESC, retry_run.id DESC
   LIMIT 1
  ) AS pre_start_retry_error_detail,
  CASE WHEN COALESCE((SELECT sum(retry_run.pre_start_attempt_count)
                      FROM review_runs AS retry_run
                      WHERE retry_run.evaluation_id = evaluations.id), 0) = 0
    OR EXISTS (
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
