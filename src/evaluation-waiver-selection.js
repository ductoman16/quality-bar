export const EVALUATION_WAIVER_SELECTION = `WITH evaluation_finding_impacts AS (
  SELECT findings.id, findings.evaluation_id,
         review_version_criteria.impact
  FROM findings
  JOIN review_runs ON review_runs.id = findings.review_run_id
  JOIN review_version_criteria
    ON review_version_criteria.review_version_id =
         review_runs.review_version_id
   AND review_version_criteria.criterion_id = findings.criterion_id
)
SELECT evaluations.*, repositories.normalized_url,
  CASE WHEN github_automatic_evaluations.evaluation_id IS NULL
              AND forgejo_automatic_evaluations.evaluation_id IS NULL
    THEN evaluations.provenance ELSE 'automatic' END AS resource_provenance,
  COALESCE(
    github_automatic_evaluations.pull_request_number,
    forgejo_automatic_evaluations.pull_request_number
  ) AS automatic_pull_request_number,
  evaluation_results.outcome AS result_outcome,
  (
    SELECT count(*) FROM waiver_adjudications
    WHERE waiver_adjudications.evaluation_id = evaluations.id
      AND waiver_adjudications.execution_status IN ('queued', 'running')
  ) AS active_waiver_adjudication_count,
  (
    SELECT count(*)
    FROM evaluation_finding_impacts
    WHERE evaluation_finding_impacts.evaluation_id = evaluations.id
      AND evaluation_finding_impacts.impact = 'blocking'
  ) AS blocking_finding_count,
  (
    SELECT count(*)
    FROM waiver_requests
    WHERE waiver_requests.evaluation_id = evaluations.id
      AND (
        SELECT CASE
          WHEN current_adjudication.execution_status IN ('failed', 'cancelled')
            THEN 1
          WHEN current_adjudication.execution_status = 'completed'
            AND (
              SELECT waiver_decisions.outcome
              FROM waiver_decisions
              WHERE waiver_decisions.waiver_adjudication_id =
                      current_adjudication.id
                AND waiver_decisions.waiver_request_id = waiver_requests.id
              ORDER BY waiver_decisions.rowid DESC
              LIMIT 1
            ) = 'error'
            THEN 1
          ELSE 0
        END
        FROM waiver_adjudication_requests
        JOIN waiver_adjudications AS current_adjudication
          ON current_adjudication.id =
               waiver_adjudication_requests.waiver_adjudication_id
        WHERE waiver_adjudication_requests.waiver_request_id =
                waiver_requests.id
        ORDER BY current_adjudication.rowid DESC
        LIMIT 1
      ) = 1
  ) AS current_waiver_error_count,
  (
    SELECT count(*)
    FROM evaluation_finding_impacts
    WHERE evaluation_finding_impacts.evaluation_id = evaluations.id
      AND evaluation_finding_impacts.impact = 'advisory'
      AND NOT EXISTS (
        SELECT 1
        FROM waiver_requests
        WHERE waiver_requests.finding_id = evaluation_finding_impacts.id
          AND (
            SELECT waiver_decisions.outcome
            FROM waiver_decisions
            WHERE waiver_decisions.waiver_request_id = waiver_requests.id
            ORDER BY waiver_decisions.rowid DESC
            LIMIT 1
          ) = 'accepted'
      )
  ) AS unwaived_advisory_finding_count,`;
