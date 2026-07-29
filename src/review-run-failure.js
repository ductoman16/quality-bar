/**
 * @param {{
 *   get(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): Record<string, import("node:sqlite").SQLInputValue> | undefined,
 *   transaction<Result>(callback: (transaction: {
 *     get(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): Record<string, import("node:sqlite").SQLInputValue> | undefined,
 *     run(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): import("node:sqlite").StatementResultingChanges
 *   }) => Result): Result
 * }} durableCore
 * @param {() => number} now
 * @param {(code: string, message: string) => never} fail
 */
export function createReviewRunFailureService(durableCore, now, fail) {
  /**
   * @param {{fencingToken: number, workerId: string, workId: string}} claim
   * @param {Error & {code: string}} failure
   */
  return function failReviewRun(claim, failure) {
    if (
      !(failure instanceof Error) ||
      !/^[a-z][a-z0-9_]*$/.test(failure.code) ||
      failure.message.trim().length === 0
    ) {
      throw new TypeError("Review Run failure is invalid");
    }
    const completedAt = now();
    if (!Number.isSafeInteger(completedAt) || completedAt < 0) {
      throw new TypeError("Review Run completion time is invalid");
    }
    return durableCore.transaction((transaction) => {
      const run = transaction.get(
        `SELECT review_runs.evaluation_id, review_runs.execution_status,
                codex_execution_queue.worker_id,
                codex_execution_queue.fencing_token,
                codex_execution_queue.lease_expires_at
         FROM review_runs
         JOIN codex_execution_queue
           ON codex_execution_queue.work_id = review_runs.id
         WHERE review_runs.id = ?`,
        claim.workId,
      );
      if (
        !run ||
        run.execution_status !== "running" ||
        run.worker_id !== claim.workerId ||
        run.fencing_token !== claim.fencingToken ||
        typeof run.lease_expires_at !== "number" ||
        run.lease_expires_at <= completedAt
      ) {
        fail(
          "submission_channel_closed",
          "Review Run submission channel is closed",
        );
      }
      if (
        transaction.get(
          `SELECT count(*) AS count
           FROM review_runs WHERE evaluation_id = ?`,
          run.evaluation_id,
        )?.count !== 1
      ) {
        fail(
          "review_run_selection_unsupported",
          "Only one selected Review Run is supported",
        );
      }
      const failed = transaction.run(
        `UPDATE review_runs
         SET execution_status = 'failed',
             completed_at = COALESCE(completed_at, ?),
             error_code = ?, error_detail = ?
         WHERE id = ? AND execution_status = 'running'`,
        completedAt,
        failure.code,
        failure.message,
        claim.workId,
      );
      if (failed.changes !== 1) {
        fail(
          "submission_channel_closed",
          "Review Run submission channel is closed",
        );
      }
      transaction.run(
        `INSERT INTO evaluation_results (
           evaluation_id, outcome, completed_at
         ) VALUES (?, 'error', ?)`,
        run.evaluation_id,
        completedAt,
      );
      transaction.run(
        `UPDATE evaluations
         SET execution_status = 'completed', completed_at = ?
         WHERE id = ? AND execution_status IN ('queued', 'running')`,
        completedAt,
        run.evaluation_id,
      );
    });
  };
}
