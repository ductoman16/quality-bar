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
              started_at, completed_at, error_code, error_detail
       FROM review_runs
       WHERE evaluation_id = ?
       ORDER BY id`,
      id,
    )
    .map((run) => {
      const status = run?.execution_status;
      return {
        completed_at: timestamp(/** @type {number} */ (run?.completed_at)),
        ...(status === "failed"
          ? {
              error: {
                code: run?.error_code,
                detail: run?.error_detail,
              },
            }
          : {}),
        id: run?.id,
        review_id: run?.review_id,
        review_version_id: run?.review_version_id,
        started_at: timestamp(/** @type {number} */ (run?.started_at)),
        status,
      };
    });
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
  const criterionResults = durableCore
    .all(
      `SELECT criterion_results.review_run_id,
            criterion_results.criterion_id,
            criterion_results.outcome,
            criterion_results.error_code,
            criterion_results.error_detail
     FROM criterion_results
     JOIN review_runs ON review_runs.id = criterion_results.review_run_id
     WHERE review_runs.evaluation_id = ?
     ORDER BY review_runs.id, criterion_results.rowid`,
      id,
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
  const findings = durableCore
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
       ORDER BY findings.rowid`,
      id,
    )
    .map((finding) => {
      const kind = finding?.location_kind;
      const side = finding?.side;
      const location =
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
            };
      return {
        criterion_id: finding?.criterion_id,
        evidence: finding?.evidence,
        id: finding?.id,
        impact: finding?.impact,
        location,
        remediation: finding?.remediation,
        review_run_id: finding?.review_run_id,
      };
    });
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
