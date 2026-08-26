export function aggregateEvaluationOutcome(facts: {
  applicabilityErrorCount: number;
  criterionErrorCount: number;
  failedOrCancelledReviewRunCount: number;
  triggeredImpacts: string[];
}) {
  if (
    !facts ||
    ![
      facts.applicabilityErrorCount,
      facts.criterionErrorCount,
      facts.failedOrCancelledReviewRunCount,
    ].every((count) => Number.isSafeInteger(count) && count >= 0) ||
    !Array.isArray(facts.triggeredImpacts) ||
    facts.triggeredImpacts.some(
      (impact) => !["advisory", "blocking"].includes(impact),
    )
  ) {
    throw new TypeError("Evaluation aggregation facts are invalid");
  }
  if (
    facts.applicabilityErrorCount > 0 ||
    facts.criterionErrorCount > 0 ||
    facts.failedOrCancelledReviewRunCount > 0
  ) {
    return "error";
  }
  if (facts.triggeredImpacts.includes("blocking")) {
    return "blocking";
  }
  return facts.triggeredImpacts.includes("advisory") ? "advisory" : "clear";
}

export function completeEvaluationIfTerminal(
  transaction: {
    all(
      sql: string,
      ...parameters: import("node:sqlite").SQLInputValue[]
    ): (Record<string, import("node:sqlite").SQLInputValue> | undefined)[];
    get(
      sql: string,
      ...parameters: import("node:sqlite").SQLInputValue[]
    ): Record<string, import("node:sqlite").SQLInputValue> | undefined;
    run(
      sql: string,
      ...parameters: import("node:sqlite").SQLInputValue[]
    ): import("node:sqlite").StatementResultingChanges;
  },
  evaluationId: string,
  completedAt: number,
) {
  if (
    typeof evaluationId !== "string" ||
    evaluationId.length === 0 ||
    !Number.isSafeInteger(completedAt) ||
    completedAt < 0
  ) {
    throw new TypeError("Evaluation completion identity is invalid");
  }
  const evaluation = transaction.get(
    `SELECT applicability_sealed_at,
            (
              SELECT count(*) FROM review_runs
              WHERE evaluation_id = evaluations.id
                AND execution_status IN ('queued', 'running')
            ) AS nonterminal_review_run_count
     FROM evaluations
     WHERE id = ?`,
    evaluationId,
  );
  const applicabilitySealedAt = evaluation?.applicability_sealed_at;
  const nonterminalReviewRunCount = evaluation?.nonterminal_review_run_count;
  if (
    !evaluation ||
    !Number.isSafeInteger(applicabilitySealedAt) ||
    !Number.isSafeInteger(nonterminalReviewRunCount)
  ) {
    throw new TypeError("Evaluation terminal facts are invalid");
  }
  if ((nonterminalReviewRunCount as number) > 0) {
    return false;
  }
  const incompleteCompletedReviewRunCount = transaction.get(
    `SELECT count(*) AS count
     FROM review_runs AS run
     WHERE run.evaluation_id = ?
       AND run.execution_status = 'completed'
       AND (
         (
           SELECT count(*) FROM criterion_results
           WHERE review_run_id = run.id
         ) <> (
           SELECT count(*) FROM review_version_criteria
           WHERE review_version_id = run.review_version_id
         )
         OR EXISTS (
           SELECT 1 FROM criterion_results AS result
           WHERE result.review_run_id = run.id
             AND NOT EXISTS (
               SELECT 1 FROM review_version_criteria AS criterion
               WHERE criterion.review_version_id = run.review_version_id
                 AND criterion.criterion_id = result.criterion_id
             )
         )
       )`,
    evaluationId,
  )?.count;
  if (incompleteCompletedReviewRunCount !== 0) {
    throw new TypeError("Completed Review Run facts are incomplete");
  }
  const applicabilityErrorCount = transaction.get(
    `SELECT count(*) AS count FROM applicability_results
     WHERE evaluation_id = ? AND outcome = 'error'`,
    evaluationId,
  )?.count;
  const failedOrCancelledReviewRunCount = transaction.get(
    `SELECT count(*) AS count FROM review_runs
     WHERE evaluation_id = ? AND execution_status IN ('failed', 'cancelled')`,
    evaluationId,
  )?.count;
  const criterionErrorCount = transaction.get(
    `SELECT count(*) AS count
     FROM criterion_results
     JOIN review_runs ON review_runs.id = criterion_results.review_run_id
     WHERE review_runs.evaluation_id = ?
       AND criterion_results.outcome = 'error'`,
    evaluationId,
  )?.count;
  const triggeredImpacts = transaction
    .all(
      `SELECT review_version_criteria.impact
       FROM criterion_results
       JOIN review_runs ON review_runs.id = criterion_results.review_run_id
       JOIN review_version_criteria
         ON review_version_criteria.review_version_id =
              review_runs.review_version_id
        AND review_version_criteria.criterion_id =
              criterion_results.criterion_id
       WHERE review_runs.evaluation_id = ?
         AND criterion_results.outcome = 'triggered'`,
      evaluationId,
    )
    .map((row) => row?.impact as string);
  const outcome = aggregateEvaluationOutcome({
    applicabilityErrorCount: applicabilityErrorCount as number,
    criterionErrorCount: criterionErrorCount as number,
    failedOrCancelledReviewRunCount: failedOrCancelledReviewRunCount as number,
    triggeredImpacts,
  });
  transaction.run(
    `INSERT INTO evaluation_results (evaluation_id, outcome, completed_at)
     VALUES (?, ?, ?)`,
    evaluationId,
    outcome,
    completedAt,
  );
  const completed = transaction.run(
    `UPDATE evaluations
     SET execution_status = 'completed', completed_at = ?
     WHERE id = ? AND execution_status IN ('queued', 'running')`,
    completedAt,
    evaluationId,
  );
  if (completed.changes !== 1) {
    throw new TypeError("Evaluation completion state is invalid");
  }
  return true;
}
