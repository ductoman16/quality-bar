/** @param {{all(sql: string): any[]}} durableCore */
export function readAutomaticEvaluationProgressionRows(durableCore) {
  return durableCore.all(
    `WITH automatic_pull_requests AS (
       SELECT * FROM github_automatic_evaluation_pull_requests
       UNION ALL
       SELECT * FROM forgejo_automatic_evaluation_pull_requests
     )
     SELECT
       evaluations.id AS evaluation_id,
       evaluations.repository_id,
       evaluations.created_at AS evaluation_created_at,
       automatic_pull_requests.pull_request_number,
       review_runs.review_id,
       review_runs.review_version_id,
       review_version_criteria.criterion_id,
       review_versions.model,
       review_versions.reasoning_effort,
       review_versions.service_tier,
       criterion_results.outcome
     FROM evaluations /* AS analytics_transition_rows */
     JOIN automatic_pull_requests
       ON automatic_pull_requests.evaluation_id = evaluations.id
     LEFT JOIN applicability_selections
       ON applicability_selections.evaluation_id = evaluations.id
     LEFT JOIN review_versions
       ON review_versions.id = applicability_selections.review_version_id
     LEFT JOIN review_version_criteria
       ON review_version_criteria.review_version_id =
            applicability_selections.review_version_id
     LEFT JOIN review_runs
       ON review_runs.evaluation_id = evaluations.id
      AND review_runs.review_id = applicability_selections.review_id
     LEFT JOIN criterion_results
       ON criterion_results.review_run_id = review_runs.id
      AND criterion_results.criterion_id = review_version_criteria.criterion_id
    ORDER BY evaluations.repository_id,
      automatic_pull_requests.pull_request_number,
      review_version_criteria.criterion_id,
      evaluations.created_at,
      evaluations.id`,
  );
}
