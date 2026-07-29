const timestamp = (/** @type {number} */ value) =>
  new Date(value).toISOString();

/**
 * @param {{
 *   all(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): (Record<string, import("node:sqlite").SQLInputValue> | undefined)[],
 *   get(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): Record<string, import("node:sqlite").SQLInputValue> | undefined
 * }} durableCore
 * @param {string} id
 */
export function readCompletedEvaluationResult(durableCore, id) {
  const row = durableCore.get(
    `SELECT evaluation_id, outcome, completed_at
     FROM evaluation_results WHERE evaluation_id = ?`,
    id,
  );
  if (!row) {
    return undefined;
  }
  const reviewRuns = durableCore
    .all(
      `SELECT id, review_id, review_version_id, execution_status,
              started_at, completed_at
       FROM review_runs
       WHERE evaluation_id = ?
       ORDER BY id`,
      id,
    )
    .map((run) => ({
      completed_at: timestamp(/** @type {number} */ (run?.completed_at)),
      id: run?.id,
      review_id: run?.review_id,
      review_version_id: run?.review_version_id,
      started_at: timestamp(/** @type {number} */ (run?.started_at)),
      status: run?.execution_status,
    }));
  const criterionResults = durableCore.all(
    `SELECT criterion_results.review_run_id,
            criterion_results.criterion_id,
            criterion_results.outcome
     FROM criterion_results
     JOIN review_runs ON review_runs.id = criterion_results.review_run_id
     WHERE review_runs.evaluation_id = ?
     ORDER BY review_runs.id, criterion_results.rowid`,
    id,
  );
  return {
    applicability_results: [],
    completed_at: timestamp(/** @type {number} */ (row.completed_at)),
    criterion_results: criterionResults,
    evaluation_id: row.evaluation_id,
    findings: [],
    outcome: row.outcome,
    review_runs: reviewRuns,
  };
}
