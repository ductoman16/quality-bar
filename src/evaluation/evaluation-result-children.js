/**
 * @param {{
 *   all(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): (Record<string, import("node:sqlite").SQLInputValue> | undefined)[]
 * }} durableCore
 * @param {string} evaluationId
 * @param {string} [reviewRunId]
 */
export function readEvaluationCriterionResults(
  durableCore,
  evaluationId,
  reviewRunId,
) {
  return durableCore
    .all(
      `SELECT criterion_results.review_run_id,
              criterion_results.criterion_id,
              criterion_results.outcome,
              criterion_results.error_code,
              criterion_results.error_detail
       FROM criterion_results
       JOIN review_runs ON review_runs.id = criterion_results.review_run_id
       WHERE review_runs.evaluation_id = ?
         ${reviewRunId === undefined ? "" : "AND review_runs.id = ?"}
       ORDER BY review_runs.id, criterion_results.rowid`,
      evaluationId,
      ...(reviewRunId === undefined ? [] : [reviewRunId]),
    )
    .map((result) => ({
      criterion_id: result?.criterion_id,
      ...(result?.outcome === "error"
        ? {
            error: {
              code: result.error_code,
              detail: result.error_detail,
            },
          }
        : {}),
      outcome: result?.outcome,
      review_run_id: result?.review_run_id,
    }));
}

/**
 * @param {{
 *   all(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): (Record<string, import("node:sqlite").SQLInputValue> | undefined)[]
 * }} durableCore
 * @param {string} evaluationId
 * @param {string} [reviewRunId]
 */
export function readEvaluationFindings(durableCore, evaluationId, reviewRunId) {
  return durableCore
    .all(
      `SELECT findings.id, findings.review_run_id, findings.criterion_id,
              findings.evidence, findings.remediation,
              findings.location_kind, findings.file_change_id,
              findings.side, findings.start_line, findings.end_line,
              review_version_criteria.impact,
              evaluation_file_changes.before_path,
              evaluation_file_changes.after_path
       FROM findings
       JOIN review_runs ON review_runs.id = findings.review_run_id
       JOIN review_version_criteria
         ON review_version_criteria.review_version_id =
              review_runs.review_version_id
        AND review_version_criteria.criterion_id = findings.criterion_id
       LEFT JOIN evaluation_file_changes
         ON evaluation_file_changes.evaluation_id = findings.evaluation_id
        AND evaluation_file_changes.id = findings.file_change_id
       WHERE findings.evaluation_id = ?
         ${reviewRunId === undefined ? "" : "AND findings.review_run_id = ?"}
       ORDER BY findings.rowid`,
      evaluationId,
      ...(reviewRunId === undefined ? [] : [reviewRunId]),
    )
    .map((finding) => {
      const kind = finding?.location_kind;
      const side = finding?.side;
      return {
        criterion_id: finding?.criterion_id,
        evidence: finding?.evidence,
        id: finding?.id,
        impact: finding?.impact,
        location:
          kind === "changeset"
            ? { kind }
            : {
                file_change_id: finding?.file_change_id,
                kind,
                path:
                  side === "base" ? finding?.before_path : finding?.after_path,
                side,
                ...(kind === "line_range"
                  ? {
                      end_line: finding?.end_line,
                      start_line: finding?.start_line,
                    }
                  : {}),
              },
        remediation: finding?.remediation,
        review_run_id: finding?.review_run_id,
      };
    });
}
