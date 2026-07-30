/** @param {any} transaction @param {string} connectionId @param {number} readyAt */
export function resumeGitHubDeliveries(transaction, connectionId, readyAt) {
  transaction.run(
    `UPDATE github_commit_statuses
     SET publication_status = 'waiting',
         published_state = NULL,
         published_at = NULL,
         error_code = NULL,
         error_detail = NULL
     WHERE publication_status = 'unavailable'
       AND repository_id IN (
         SELECT repository_id FROM github_repositories
         WHERE connection_id = ?
       )`,
    connectionId,
  );
  for (const table of ["github_feedback_bundles", "github_finding_feedback"]) {
    transaction.run(
      `UPDATE ${table}
       SET publication_status = 'waiting',
           external_id = NULL,
           published_at = NULL,
           error_code = NULL,
           error_detail = NULL
       WHERE publication_status = 'unavailable'
         AND evaluation_id IN (
           SELECT github_automatic_evaluations.evaluation_id
           FROM github_automatic_evaluations
           JOIN github_repositories
             ON github_repositories.repository_id =
                  github_automatic_evaluations.repository_id
           WHERE github_repositories.connection_id = ?
         )`,
      connectionId,
    );
  }
  transaction.run(
    `UPDATE github_delivery_attempts
     SET next_attempt_at = ?,
         reconciliation_required = 0,
         error_code = NULL,
         error_detail = NULL,
         definitive = 0
     WHERE definitive = 1
       AND (
         (surface = 'commit_status' AND source_id IN (
           SELECT evaluation_id || ':' || desired_state
           FROM github_commit_statuses
           WHERE repository_id IN (
             SELECT repository_id FROM github_repositories
             WHERE connection_id = ?
           )
         ))
         OR
         (surface = 'aggregate_feedback' AND source_id IN (
           SELECT github_automatic_evaluations.evaluation_id
           FROM github_automatic_evaluations
           JOIN github_repositories
             ON github_repositories.repository_id =
                  github_automatic_evaluations.repository_id
           WHERE github_repositories.connection_id = ?
         ))
         OR
         (surface = 'inline_feedback' AND source_id IN (
           SELECT github_finding_feedback.finding_id
           FROM github_finding_feedback
           JOIN github_automatic_evaluations
             ON github_automatic_evaluations.evaluation_id =
                  github_finding_feedback.evaluation_id
           JOIN github_repositories
             ON github_repositories.repository_id =
                  github_automatic_evaluations.repository_id
           WHERE github_repositories.connection_id = ?
         ))
       )`,
    readyAt,
    connectionId,
    connectionId,
    connectionId,
  );
  transaction.run(
    "DELETE FROM github_delivery_provider_gates WHERE connection_id = ?",
    connectionId,
  );
}
