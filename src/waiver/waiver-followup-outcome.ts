import { effectiveEvaluationOutcome } from "./waiver-effective-outcome.ts";

export function readEffectiveWaiverOutcome(
  durableCore: any,
  evaluationId: string,
) {
  const row = durableCore.get(
    `SELECT evaluation_results.outcome AS result_outcome,
       (SELECT count(*) FROM waiver_adjudications
        WHERE evaluation_id = evaluations.id
          AND execution_status IN ('queued', 'running')) AS active_count,
       (SELECT count(*) FROM waiver_adjudications
        WHERE evaluation_id = evaluations.id) AS adjudication_count,
       (SELECT count(*) FROM findings
        JOIN review_runs ON review_runs.id = findings.review_run_id
        JOIN review_version_criteria
          ON review_version_criteria.review_version_id = review_runs.review_version_id
         AND review_version_criteria.criterion_id = findings.criterion_id
        WHERE findings.evaluation_id = evaluations.id
          AND review_version_criteria.impact = 'blocking') AS blocking_count,
       (SELECT count(*) FROM waiver_requests
        WHERE waiver_requests.evaluation_id = evaluations.id
          AND (SELECT CASE
            WHEN adjudication.execution_status IN ('failed', 'cancelled') THEN 1
            WHEN adjudication.execution_status = 'completed'
              AND waiver_decisions.outcome = 'error' THEN 1 ELSE 0 END
          FROM waiver_adjudication_requests
          JOIN waiver_adjudications AS adjudication
            ON adjudication.id = waiver_adjudication_requests.waiver_adjudication_id
          LEFT JOIN waiver_decisions
            ON waiver_decisions.waiver_adjudication_id = adjudication.id
           AND waiver_decisions.waiver_request_id = waiver_requests.id
          WHERE waiver_adjudication_requests.waiver_request_id = waiver_requests.id
          ORDER BY adjudication.rowid DESC LIMIT 1) = 1) AS error_count,
       (SELECT count(*) FROM findings
        JOIN review_runs ON review_runs.id = findings.review_run_id
        JOIN review_version_criteria
          ON review_version_criteria.review_version_id = review_runs.review_version_id
         AND review_version_criteria.criterion_id = findings.criterion_id
        WHERE findings.evaluation_id = evaluations.id
          AND review_version_criteria.impact = 'advisory'
          AND NOT EXISTS (
            SELECT 1 FROM waiver_requests
            WHERE waiver_requests.finding_id = findings.id
              AND (SELECT waiver_decisions.outcome
                   FROM waiver_decisions
                   WHERE waiver_decisions.waiver_request_id = waiver_requests.id
                   ORDER BY waiver_decisions.rowid DESC LIMIT 1) = 'accepted'
          )) AS unwaived_count
     FROM evaluations
     LEFT JOIN evaluation_results
       ON evaluation_results.evaluation_id = evaluations.id
     WHERE evaluations.id = ?`,
    evaluationId,
  );
  if (!row) {
    throw new TypeError("Waiver follow-up Evaluation is invalid");
  }
  if (row.adjudication_count === 0) {
    return (row.result_outcome ?? "pending") as string;
  }
  return effectiveEvaluationOutcome({
    activeAdjudicationCount: row.active_count as number,
    blockingFindingCount: row.blocking_count as number,
    currentWaiverErrorCount: row.error_count as number,
    resultOutcome: (row.result_outcome ?? "pending") as string,
    unwaivedAdvisoryFindingCount: row.unwaived_count as number,
  });
}
