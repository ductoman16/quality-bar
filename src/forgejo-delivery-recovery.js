/** @param {any} transaction @param {string} connectionId @param {number} readyAt @param {number[]} [repositoryIds] */
export function resumeForgejoDeliveries(
  transaction,
  connectionId,
  readyAt,
  repositoryIds,
) {
  if (
    repositoryIds &&
    (new Set(repositoryIds).size !== repositoryIds.length ||
      repositoryIds.some(
        (repositoryId) =>
          !Number.isSafeInteger(repositoryId) || repositoryId <= 0,
      ))
  ) {
    throw new TypeError("Forgejo delivery recovery scope is invalid");
  }
  if (repositoryIds?.length === 0) {
    return;
  }
  const scope = repositoryIds
    ? ` AND forge_repository_id IN (${repositoryIds.map(() => "?").join(", ")})`
    : "";
  const parameters = repositoryIds ?? [];
  transaction.run(
    `UPDATE forgejo_delivery_attempts
     SET generation = generation + 1, next_attempt_at = ?,
         error_code = NULL, error_detail = NULL, response_status = NULL,
         definitive = 0
     WHERE definitive = 1
       AND (
         (surface = 'commit_status' AND source_id IN (
           SELECT evaluation_id || ':' || desired_state
           FROM forgejo_commit_statuses
           WHERE repository_id IN (
             SELECT repository_id FROM forgejo_repositories
             WHERE connection_id = ?${scope}
           )
         ))
         OR (surface = 'aggregate_feedback' AND source_id IN (
           SELECT forgejo_automatic_evaluations.evaluation_id
           FROM forgejo_automatic_evaluations
           JOIN forgejo_repositories
             ON forgejo_repositories.repository_id =
                  forgejo_automatic_evaluations.repository_id
           WHERE forgejo_repositories.connection_id = ?${scope}
         ))
         OR (surface = 'inline_feedback' AND source_id IN (
           SELECT forgejo_finding_feedback.finding_id
           FROM forgejo_finding_feedback
           JOIN forgejo_automatic_evaluations
             ON forgejo_automatic_evaluations.evaluation_id =
                  forgejo_finding_feedback.evaluation_id
           JOIN forgejo_repositories
             ON forgejo_repositories.repository_id =
                  forgejo_automatic_evaluations.repository_id
           WHERE forgejo_repositories.connection_id = ?${scope}
         ))
       )`,
    readyAt,
    connectionId,
    ...parameters,
    connectionId,
    ...parameters,
    connectionId,
    ...parameters,
  );
  transaction.run(
    `UPDATE forgejo_commit_statuses
     SET publication_status = 'waiting', published_state = NULL,
         published_at = NULL, external_id = NULL,
         error_code = NULL, error_detail = NULL
     WHERE publication_status = 'unavailable'
       AND EXISTS (
         SELECT 1 FROM forgejo_delivery_attempts
         WHERE surface = 'commit_status'
           AND source_id =
                 forgejo_commit_statuses.evaluation_id || ':' ||
                 forgejo_commit_statuses.desired_state
           AND definitive = 0 AND error_code IS NULL
           AND next_attempt_at = ?
       )`,
    readyAt,
  );
  for (const [table, surface, identity] of [
    ["forgejo_feedback_bundles", "aggregate_feedback", "evaluation_id"],
    ["forgejo_finding_feedback", "inline_feedback", "finding_id"],
  ]) {
    transaction.run(
      `UPDATE ${table}
       SET publication_status = 'waiting', external_id = NULL,
           published_at = NULL, error_code = NULL, error_detail = NULL
       WHERE publication_status = 'unavailable'
         AND EXISTS (
           SELECT 1 FROM forgejo_delivery_attempts
           WHERE surface = ? AND source_id = ${table}.${identity}
             AND definitive = 0 AND error_code IS NULL
             AND next_attempt_at = ?
         )`,
      surface,
      readyAt,
    );
  }
  transaction.run(
    `DELETE FROM forgejo_delivery_provider_gates
     WHERE connection_id = ?`,
    connectionId,
  );
}
