const RESULT_TO_STATE = Object.freeze({
  advisory: "failure",
  blocking: "failure",
  clear: "success",
  error: "error",
});

function stateForOutcome(value: unknown) {
  if (
    value !== "advisory" &&
    value !== "blocking" &&
    value !== "clear" &&
    value !== "error"
  ) {
    return undefined;
  }
  return RESULT_TO_STATE[value];
}

function addHistoricalState(sources: Set<string>, row: any) {
  sources.add(`${row.evaluation_id}:pending`);
  const state = stateForOutcome(row.outcome);
  if (state !== undefined) {
    sources.add(`${row.evaluation_id}:${state}`);
  }
}

export function readCommitDeliverySources(
  durableCore: any,
  provider: "github" | "forgejo",
) {
  const sources = new Set<string>();
  for (const row of durableCore.all(
    `SELECT evaluation_id, desired_state FROM ${provider}_commit_statuses`,
  )) {
    sources.add(`${row.evaluation_id}:${row.desired_state}`);
    if (row.desired_state !== "pending") {
      sources.add(`${row.evaluation_id}:pending`);
    }
  }
  for (const row of durableCore.all(
    `SELECT evaluations.id AS evaluation_id, evaluation_results.outcome
       FROM evaluations
       JOIN ${provider}_repositories AS repositories
         ON repositories.repository_id = evaluations.repository_id
       LEFT JOIN evaluation_results
         ON evaluation_results.evaluation_id = evaluations.id
     UNION ALL
     SELECT followups.evaluation_id, followups.outcome
       FROM ${provider}_waiver_adjudication_followups AS followups
       JOIN evaluations
         ON evaluations.id = followups.evaluation_id
       JOIN ${provider}_repositories AS repositories
         ON repositories.repository_id = evaluations.repository_id
     UNION ALL
     SELECT adjudications.evaluation_id, 'error' AS outcome
       FROM waiver_adjudications AS adjudications
       JOIN evaluations
         ON evaluations.id = adjudications.evaluation_id
       JOIN ${provider}_repositories AS repositories
         ON repositories.repository_id = evaluations.repository_id
      WHERE adjudications.execution_status IN ('failed', 'cancelled')`,
  )) {
    addHistoricalState(sources, row);
  }
  return sources;
}
