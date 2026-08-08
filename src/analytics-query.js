import {
  filteredCriterionScopes,
  filteredEvaluationIds,
  filteredReviewScopes,
} from "./analytics-filter.js";
import {
  analyticsEventWindow,
  analyticsWaiverFilters,
} from "./analytics-query-window.js";
import { EVALUATION_WAIVER_SELECTION } from "./evaluation-waiver-selection.js";
import { readAutomaticEvaluationProgressionRows } from "./analytics-automatic-progression-query.js";

/**
 * @param {{
 *   all(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): Array<Record<string, import("node:sqlite").SQLInputValue> | undefined>
 * }} durableCore
 * @param {Record<string, unknown>} filters
 * @param {(row: Record<string, import("node:sqlite").SQLInputValue> | undefined) => string} evaluationOutcome
 * @param {{end: number, start: number}} evaluationOverviewWindow
 */
export function readAnalyticsFactRows(
  durableCore,
  filters,
  evaluationOutcome,
  evaluationOverviewWindow,
) {
  const evaluationRows = durableCore.all(
    `${EVALUATION_WAIVER_SELECTION}
     evaluations.id AS analytics_evaluation_id
     FROM evaluations
     JOIN repositories ON repositories.id = evaluations.repository_id
     LEFT JOIN github_automatic_evaluations
       ON github_automatic_evaluations.evaluation_id = evaluations.id
     LEFT JOIN forgejo_automatic_evaluations
       ON forgejo_automatic_evaluations.evaluation_id = evaluations.id
     LEFT JOIN evaluation_results
       ON evaluation_results.evaluation_id = evaluations.id
     ORDER BY evaluations.rowid`,
  );
  const overviewWindow = analyticsEventWindow(
    "evaluations.created_at",
    evaluationOverviewWindow,
  );
  const evaluationOverviewRows = durableCore.all(
    `${EVALUATION_WAIVER_SELECTION}
     evaluations.id AS analytics_evaluation_id,
     evaluations.execution_status,
     evaluations.created_at,
     evaluations.completed_at,
     evaluation_results.outcome AS effective_outcome_source
     FROM evaluations
     JOIN repositories ON repositories.id = evaluations.repository_id
     LEFT JOIN github_automatic_evaluations
       ON github_automatic_evaluations.evaluation_id = evaluations.id
     LEFT JOIN forgejo_automatic_evaluations
       ON forgejo_automatic_evaluations.evaluation_id = evaluations.id
     LEFT JOIN evaluation_results
       ON evaluation_results.evaluation_id = evaluations.id
     WHERE ${overviewWindow.sql}
     ORDER BY evaluations.rowid`,
    ...overviewWindow.parameters,
  );
  const progressionRows = readAutomaticEvaluationProgressionRows(durableCore);
  const filterFactRows = durableCore.all(
    `SELECT
       evaluations.id AS evaluation_id,
       applicability_selections.review_id,
       applicability_selections.review_version_id,
       review_version_criteria.criterion_id,
       review_versions.model,
       review_versions.reasoning_effort,
       review_versions.service_tier
     FROM
       evaluations /* AS analytics_filter_rows */
     JOIN applicability_selections
       ON applicability_selections.evaluation_id = evaluations.id
     JOIN review_versions
       ON review_versions.id = applicability_selections.review_version_id
     JOIN review_version_criteria
       ON review_version_criteria.review_version_id =
            applicability_selections.review_version_id
    ORDER BY
      evaluations.id,
      applicability_selections.review_id,
      review_version_criteria.position`,
  );
  const outcomeRows =
    /** @type {Array<Record<string, import("node:sqlite").SQLInputValue> & {terminal_outcome: string}>} */ (
      evaluationRows.map((row) => ({
        ...row,
        terminal_outcome: evaluationOutcome(row),
      }))
    );
  const selectedEvaluationIds = filteredEvaluationIds(
    /** @type {Record<string, unknown>[]} */ (outcomeRows),
    /** @type {Record<string, unknown>[]} */ (filterFactRows),
    filters,
  );
  const waiverEvaluationIds = filteredEvaluationIds(
    /** @type {Record<string, unknown>[]} */ (outcomeRows),
    /** @type {Record<string, unknown>[]} */ (filterFactRows),
    analyticsWaiverFilters(filters),
  );
  const hasFilters = Object.keys(filters).length > 0;
  const reviewScopes = filteredReviewScopes(
    /** @type {Record<string, unknown>[]} */ (filterFactRows),
    selectedEvaluationIds,
    filters,
  );
  const criterionScopes = filteredCriterionScopes(
    /** @type {Record<string, unknown>[]} */ (filterFactRows),
    selectedEvaluationIds,
    filters,
  );
  const waiverCriterionScopes = filteredCriterionScopes(
    /** @type {Record<string, unknown>[]} */ (filterFactRows),
    waiverEvaluationIds,
    filters,
  );
  const reviewDimensionFiltered = [
    "review_id",
    "review_version_id",
    "criterion_id",
    "model",
    "reasoning_effort",
    "service_tier",
  ].some((name) => filters[name] !== undefined);
  /**
   * @param {Record<string, import("node:sqlite").SQLInputValue> | undefined} row
   * @param {Set<string>} [scopes]
   * @param {Set<string>} [evaluationIds]
   */
  const inReviewScope = (
    row,
    scopes = reviewScopes,
    evaluationIds = selectedEvaluationIds,
  ) =>
    !hasFilters ||
    (typeof row?.evaluation_id === "string" &&
      evaluationIds.has(row.evaluation_id) &&
      (!reviewDimensionFiltered ||
        scopes.has([row?.evaluation_id, row?.review_id].join("\0"))));
  /**
   * @param {Record<string, import("node:sqlite").SQLInputValue> | undefined} row
   * @param {Set<string>} [scopes]
   * @param {Set<string>} [evaluationIds]
   */
  const inCriterionScope = (
    row,
    scopes = criterionScopes,
    evaluationIds = selectedEvaluationIds,
  ) =>
    !hasFilters ||
    (typeof row?.evaluation_id === "string" &&
      evaluationIds.has(row.evaluation_id) &&
      (!reviewDimensionFiltered ||
        scopes.has(
          [row?.evaluation_id, row?.review_id, row?.criterion_id].join("\0"),
        )));
  const applicabilityRows = durableCore
    .all(
      `SELECT applicability_results.evaluation_id,
              applicability_results.review_id,
              applicability_results.outcome
         FROM applicability_results
        ORDER BY applicability_results.review_id, applicability_results.rowid`,
    )
    .filter((row) => inReviewScope(row));
  const allCriterionRows = durableCore.all(
    `SELECT review_runs.evaluation_id, review_runs.review_id,
              review_runs.id AS review_run_id,
              criterion_results.criterion_id,
              criterion_results.outcome
         /* AS analytics_criterion_rows */
         FROM criterion_results
         JOIN review_runs ON review_runs.id = criterion_results.review_run_id
        ORDER BY criterion_results.criterion_id, criterion_results.rowid`,
  );
  const criterionRows = allCriterionRows.filter((row) => inCriterionScope(row));
  const filteredEvaluationRows = hasFilters
    ? outcomeRows.filter((row) =>
        selectedEvaluationIds.has(
          /** @type {string} */ (row.analytics_evaluation_id),
        ),
      )
    : outcomeRows;
  const allFindingRows = durableCore.all(
    `SELECT findings.evaluation_id, review_runs.review_id,
              review_runs.id AS review_run_id, findings.id AS finding_id,
              findings.criterion_id,
              review_version_criteria.impact AS finding_impact
         /* AS finding_impact */
         FROM findings
         JOIN review_runs ON review_runs.id = findings.review_run_id
         JOIN review_version_criteria
           ON review_version_criteria.review_version_id =
                review_runs.review_version_id
          AND review_version_criteria.criterion_id = findings.criterion_id
        ORDER BY findings.rowid`,
  );
  const findingRows = allFindingRows.filter((row) => inCriterionScope(row));
  const requestWindow = analyticsEventWindow(
    "waiver_requests.created_at",
    filters,
  );
  const decisionWindow = analyticsEventWindow(
    "waiver_decisions.created_at",
    filters,
  );
  const waiverRows = durableCore
    .all(
      `SELECT findings.evaluation_id, review_runs.review_id,
       review_runs.id AS review_run_id, findings.id AS finding_id,
       findings.criterion_id,
       EXISTS (
         SELECT 1 FROM waiver_requests
          WHERE waiver_requests.finding_id = findings.id
            AND ${requestWindow.sql}
       ) AS has_waiver_request,
       EXISTS (
         SELECT 1
           FROM waiver_requests
           JOIN waiver_decisions
             ON waiver_decisions.waiver_request_id = waiver_requests.id
          WHERE waiver_requests.finding_id = findings.id
            AND waiver_decisions.outcome = 'accepted'
            AND ${decisionWindow.sql}
       ) AS has_accepted_decision
       FROM findings
       JOIN review_runs ON review_runs.id = findings.review_run_id
       JOIN review_version_criteria
         ON review_version_criteria.review_version_id =
              review_runs.review_version_id
        AND review_version_criteria.criterion_id = findings.criterion_id
      WHERE review_version_criteria.impact = 'advisory'
      ORDER BY findings.rowid`,
      ...requestWindow.parameters,
      ...decisionWindow.parameters,
    )
    .filter((row) =>
      inCriterionScope(row, waiverCriterionScopes, waiverEvaluationIds),
    );
  const decisionRows = durableCore
    .all(
      `SELECT waiver_requests.evaluation_id, review_runs.review_id,
              review_runs.id AS review_run_id,
              findings.id AS finding_id,
              findings.criterion_id,
              waiver_requests.id AS waiver_request_id,
              waiver_decisions.id AS waiver_decision_id,
              waiver_decisions.created_at,
              waiver_decisions.outcome
         /* AS analytics_decision_rows */
         FROM waiver_decisions
         JOIN waiver_requests
           ON waiver_requests.id = waiver_decisions.waiver_request_id
         JOIN findings ON findings.id = waiver_requests.finding_id
         JOIN review_runs ON review_runs.id = findings.review_run_id
        WHERE ${decisionWindow.sql}
        ORDER BY waiver_decisions.rowid`,
      ...decisionWindow.parameters,
    )
    .filter((row) =>
      inCriterionScope(row, waiverCriterionScopes, waiverEvaluationIds),
    );
  const waiverRequestRows = durableCore
    .all(
      `SELECT waiver_requests.id AS waiver_request_id,
              waiver_requests.evaluation_id,
              waiver_requests.finding_id,
              waiver_requests.created_at,
              review_runs.id AS review_run_id,
              review_runs.review_id,
              findings.criterion_id
         FROM waiver_requests
         JOIN findings ON findings.id = waiver_requests.finding_id
         JOIN review_runs ON review_runs.id = findings.review_run_id
        WHERE ${requestWindow.sql}
        ORDER BY waiver_requests.rowid`,
      ...requestWindow.parameters,
    )
    .filter((row) =>
      inCriterionScope(row, waiverCriterionScopes, waiverEvaluationIds),
    );
  const allReviewRunRows = durableCore.all(
    `SELECT analytics_review_runs.id,
              analytics_review_runs.evaluation_id,
              /* AS analytics_review_run_rows */
              analytics_review_runs.review_id,
              analytics_review_runs.review_version_id,
              analytics_review_runs.created_at,
              analytics_review_runs.execution_status,
              analytics_review_runs.started_at,
              analytics_review_runs.completed_at,
              analytics_review_runs.error_code,
              analytics_review_runs.input_tokens,
              analytics_review_runs.cached_input_tokens,
              analytics_review_runs.output_tokens,
              evaluations.cancellation_code,
              review_versions.model,
              review_versions.reasoning_effort,
              review_versions.service_tier,
              evaluations.repository_id,
              evaluations.base_commit,
              evaluations.head_commit,
              COALESCE(
                github_automatic_evaluation_pull_requests.pull_request_number,
                forgejo_automatic_evaluation_pull_requests.pull_request_number
              ) AS pull_request_number
         FROM review_runs AS analytics_review_runs
         JOIN evaluations
           ON evaluations.id = analytics_review_runs.evaluation_id
         JOIN review_versions
           ON review_versions.id = analytics_review_runs.review_version_id
         LEFT JOIN github_automatic_evaluation_pull_requests
           ON github_automatic_evaluation_pull_requests.evaluation_id =
                evaluations.id
         LEFT JOIN forgejo_automatic_evaluation_pull_requests
           ON forgejo_automatic_evaluation_pull_requests.evaluation_id =
                evaluations.id
        ORDER BY analytics_review_runs.rowid`,
  );
  const reviewRunRows = allReviewRunRows.filter((row) => inReviewScope(row));
  const adjudicationWindow = analyticsEventWindow(
    "analytics_waiver_adjudications.created_at",
    filters,
  );
  const adjudicationScopeRows = durableCore.all(
    `SELECT DISTINCT
       /* AS analytics_adjudication_scope_rows */
       waiver_adjudications.id AS waiver_adjudication_id,
       waiver_adjudications.evaluation_id,
       review_runs.id AS review_run_id,
       review_runs.review_id,
       findings.criterion_id
     FROM waiver_adjudications
     JOIN waiver_adjudication_requests
       ON waiver_adjudication_requests.waiver_adjudication_id =
            waiver_adjudications.id
     JOIN waiver_requests
       ON waiver_requests.id =
            waiver_adjudication_requests.waiver_request_id
     JOIN findings ON findings.id = waiver_requests.finding_id
     JOIN review_runs ON review_runs.id = findings.review_run_id
    ORDER BY waiver_adjudications.rowid`,
  );
  const matchingAdjudicationScopes = adjudicationScopeRows.filter((row) =>
    inCriterionScope(row, waiverCriterionScopes, waiverEvaluationIds),
  );
  const matchingAdjudicationIds = new Set(
    matchingAdjudicationScopes.map((row) => row?.waiver_adjudication_id),
  );
  const waiverAdjudicationRows = durableCore
    .all(
      `SELECT id, evaluation_id, execution_status, started_at, completed_at,
              error_code, input_tokens, cached_input_tokens, output_tokens,
              model, reasoning_effort, service_tier
         FROM waiver_adjudications AS analytics_waiver_adjudications
        WHERE ${adjudicationWindow.sql}
        ORDER BY rowid`,
      ...adjudicationWindow.parameters,
    )
    .filter(
      (row) =>
        !hasFilters ||
        (typeof row?.evaluation_id === "string" &&
          waiverEvaluationIds.has(row.evaluation_id) &&
          (filters.model === undefined || row?.model === filters.model) &&
          (filters.reasoning_effort === undefined ||
            row?.reasoning_effort === filters.reasoning_effort) &&
          (filters.service_tier === undefined ||
            row?.service_tier === filters.service_tier) &&
          (!reviewDimensionFiltered || matchingAdjudicationIds.has(row?.id))),
    );
  const matchingReviewRunIds = new Set([
    ...reviewRunRows.map((row) => row?.id),
    ...waiverRows.map((row) => row?.review_run_id),
    ...waiverRequestRows.map((row) => row?.review_run_id),
    ...decisionRows.map((row) => row?.review_run_id),
    ...matchingAdjudicationScopes.map((row) => row?.review_run_id),
  ]);
  const matchingReviewRunRows = allReviewRunRows.filter((row) =>
    matchingReviewRunIds.has(row?.id),
  );
  const evaluationReviewRunIds = new Set(reviewRunRows.map((row) => row?.id));
  const matchingCriterionRows = allCriterionRows.filter(
    (row) =>
      matchingReviewRunIds.has(row?.review_run_id) &&
      (evaluationReviewRunIds.has(row?.review_run_id)
        ? inCriterionScope(row)
        : inCriterionScope(row, waiverCriterionScopes, waiverEvaluationIds)),
  );
  const matchingFindingRows = allFindingRows.filter(
    (row) =>
      matchingReviewRunIds.has(row?.review_run_id) &&
      (evaluationReviewRunIds.has(row?.review_run_id)
        ? inCriterionScope(row)
        : inCriterionScope(row, waiverCriterionScopes, waiverEvaluationIds)),
  );
  return {
    applicabilityRows,
    criterionRows,
    decisionRows,
    evaluationRows,
    evaluationOverviewRows,
    filteredEvaluationRows,
    findingRows,
    matchingCriterionRows,
    matchingFindingRows,
    matchingReviewRunRows,
    progressionRows,
    reviewRunRows,
    selectedCriterionScopes: criterionScopes,
    selectedEvaluationIds,
    waiverAdjudicationRows,
    waiverRequestRows,
    waiverRows,
  };
}
