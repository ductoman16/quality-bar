import {
  readEvaluationCriterionResults,
  readEvaluationFindings,
} from "./evaluation-result-children.js";

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
    `SELECT evaluation_results.evaluation_id, evaluation_results.outcome,
            evaluation_results.completed_at
     FROM evaluation_results
     WHERE evaluation_results.evaluation_id = ?`,
    id,
  );
  if (!row) {
    return undefined;
  }
  const reviewRuns = durableCore.all(
    "SELECT id FROM review_runs WHERE evaluation_id = ? ORDER BY id",
    id,
  );
  const applicabilityResults = durableCore
    .all(
      `SELECT review_id, review_version_id, assignment_scope,
              profile, rule_source, outcome, evidence_json,
              error_code, error_detail, error_context_json
       FROM applicability_results
       WHERE evaluation_id = ?
       ORDER BY review_id`,
      id,
    )
    .map((result) => ({
      assignment: { scope: result?.assignment_scope },
      ...(result?.outcome === "error"
        ? {
            error: JSON.parse(
              /** @type {string} */ (result.error_context_json),
            ),
          }
        : {
            evidence: JSON.parse(/** @type {string} */ (result?.evidence_json)),
          }),
      outcome: result?.outcome,
      review_id: result?.review_id,
      review_version_id: result?.review_version_id,
      rule:
        result?.rule_source === null
          ? null
          : {
              profile: result?.profile,
              source: result?.rule_source,
            },
    }));
  const criterionResults = readEvaluationCriterionResults(durableCore, id);
  const fileChanges = durableCore
    .all(
      `SELECT id, added, deleted, modified, renamed,
              before_path, after_path, patch
       FROM evaluation_file_changes
       WHERE evaluation_id = ?
       ORDER BY id`,
      id,
    )
    .map((fileChange) => ({
      added: fileChange?.added === 1,
      after_path: fileChange?.after_path,
      before_path: fileChange?.before_path,
      deleted: fileChange?.deleted === 1,
      id: fileChange?.id,
      modified: fileChange?.modified === 1,
      patch: fileChange?.patch,
      renamed: fileChange?.renamed === 1,
    }));
  const findings = readEvaluationFindings(durableCore, id);
  return {
    applicability_results: applicabilityResults,
    completed_at: timestamp(/** @type {number} */ (row.completed_at)),
    criterion_results: criterionResults,
    evaluation_id: row.evaluation_id,
    file_changes: fileChanges,
    findings,
    outcome: row.outcome,
    review_runs: reviewRuns,
  };
}
