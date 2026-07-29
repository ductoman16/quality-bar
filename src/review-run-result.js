export class ReviewRunExecutionError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {ErrorOptions} [options]
   */
  constructor(code, message, options) {
    super(message, options);
    this.name = "ReviewRunExecutionError";
    this.code = code;
  }
}

/**
 * @param {string} code
 * @param {string} message
 * @returns {never}
 */
function fail(code, message) {
  throw new ReviewRunExecutionError(code, message);
}

/**
 * @param {unknown} candidate
 * @param {string[]} criterionIds
 */
export function validateClearReviewRunSubmission(candidate, criterionIds) {
  if (
    !candidate ||
    Array.isArray(candidate) ||
    typeof candidate !== "object" ||
    Object.getPrototypeOf(candidate) !== Object.prototype ||
    Object.keys(candidate).length !== 1 ||
    !Array.isArray(
      /** @type {{criterion_results?: unknown}} */ (candidate)
        .criterion_results,
    )
  ) {
    fail(
      "review_run_submission_invalid",
      "Review Run submission must contain only criterion_results",
    );
  }
  const results = /** @type {{criterion_id?: unknown, outcome?: unknown}[]} */ (
    /** @type {{criterion_results: unknown[]}} */ (candidate).criterion_results
  );
  for (const result of results) {
    if (
      !result ||
      Array.isArray(result) ||
      typeof result !== "object" ||
      Object.getPrototypeOf(result) !== Object.prototype ||
      Object.keys(result).length !== 2 ||
      typeof result.criterion_id !== "string" ||
      typeof result.outcome !== "string"
    ) {
      fail(
        "criterion_result_invalid",
        "Criterion Result must contain only criterion_id and outcome",
      );
    }
    if (result.outcome !== "clear") {
      fail(
        "criterion_result_outcome_unsupported",
        "Only clear Criterion Results are supported by this Review Run",
      );
    }
  }
  const submittedIds = results.map(
    ({ criterion_id: criterionId }) => /** @type {string} */ (criterionId),
  );
  if (
    submittedIds.length !== criterionIds.length ||
    new Set(submittedIds).size !== submittedIds.length ||
    submittedIds.some((id, index) => id !== criterionIds[index])
  ) {
    fail(
      "criterion_result_coverage_invalid",
      "Criterion Results must cover every frozen Criterion exactly once and in order",
    );
  }
  return results.map(({ criterion_id: criterionId, outcome }) => ({
    criterion_id: /** @type {string} */ (criterionId),
    outcome: /** @type {string} */ (outcome),
  }));
}

/**
 * @param {{
 *   all(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): (Record<string, import("node:sqlite").SQLInputValue> | undefined)[],
 *   get(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): Record<string, import("node:sqlite").SQLInputValue> | undefined,
 *   transaction<Result>(callback: (transaction: {
 *     all(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): (Record<string, import("node:sqlite").SQLInputValue> | undefined)[],
 *     get(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): Record<string, import("node:sqlite").SQLInputValue> | undefined,
 *     run(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): import("node:sqlite").StatementResultingChanges
 *   }) => Result): Result
 * }} durableCore
 * @param {{now?: () => number}} [options]
 */
export function createReviewRunResultService(
  durableCore,
  { now = () => Date.now() } = {},
) {
  return {
    /**
     * @param {{fencingToken: number, workerId: string, workId: string}} claim
     * @param {unknown} candidate
     */
    submit(claim, candidate) {
      const completedAt = now();
      if (!Number.isSafeInteger(completedAt) || completedAt < 0) {
        throw new TypeError("Review Run completion time is invalid");
      }
      return durableCore.transaction((transaction) => {
        const run = transaction.get(
          `SELECT review_runs.evaluation_id, review_runs.review_version_id,
                  review_runs.execution_status,
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
        const criterionIds = transaction
          .all(
            `SELECT criterion_id
             FROM review_version_criteria
             WHERE review_version_id = ?
             ORDER BY position`,
            run.review_version_id,
          )
          .map((row) => {
            if (typeof row?.criterion_id !== "string") {
              throw new TypeError("Frozen Review Criterion is invalid");
            }
            return row.criterion_id;
          });
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
        const results = validateClearReviewRunSubmission(
          candidate,
          criterionIds,
        );
        for (const result of results) {
          transaction.run(
            `INSERT INTO criterion_results (
               review_run_id, criterion_id, outcome
             ) VALUES (?, ?, 'clear')`,
            claim.workId,
            result.criterion_id,
          );
        }
        const completed = transaction.run(
          `UPDATE review_runs
           SET execution_status = 'completed', completed_at = ?
           WHERE id = ? AND execution_status = 'running'`,
          completedAt,
          claim.workId,
        );
        if (completed.changes !== 1) {
          fail(
            "submission_channel_closed",
            "Review Run submission channel is closed",
          );
        }
        const evaluationId = /** @type {string} */ (run.evaluation_id);
        transaction.run(
          `INSERT INTO evaluation_results (
             evaluation_id, outcome, completed_at
           ) VALUES (?, 'clear', ?)`,
          evaluationId,
          completedAt,
        );
        transaction.run(
          `UPDATE evaluations
           SET execution_status = 'completed', completed_at = ?
           WHERE id = ? AND execution_status IN ('queued', 'running')`,
          completedAt,
          evaluationId,
        );
      });
    },
  };
}
