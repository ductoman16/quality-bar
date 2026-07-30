/** @param {any} transaction @param {string} connectionId @param {number} readyAt */
export function resumeGitHubDeliveries(transaction, connectionId, readyAt) {
  transaction.run(
    `UPDATE github_delivery_attempts
     SET generation = generation + 1,
         next_attempt_at = ?,
         error_code = NULL,
         error_detail = NULL,
         response_status = NULL,
         definitive = 0
     WHERE definitive = 1
       AND (
         error_code IN (
           'github_app_profile_mismatch',
           'github_connection_credential_invalid',
           'github_connection_credential_undecryptable',
           'github_connection_retired',
           'github_installation_scope_invalid',
           'github_permissions_mismatch',
           'github_principal_mismatch',
           'github_repository_api_access_failed'
         )
         OR (
           error_code = 'github_api_request_failed'
           AND response_status IN (401, 403)
         )
       )
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
    `UPDATE github_commit_statuses
     SET publication_status = 'waiting',
         published_state = NULL,
         published_at = NULL,
         error_code = NULL,
         error_detail = NULL
     WHERE publication_status = 'unavailable'
       AND EXISTS (
         SELECT 1 FROM github_delivery_attempts
         WHERE surface = 'commit_status'
           AND source_id =
                 github_commit_statuses.evaluation_id || ':' ||
                 github_commit_statuses.desired_state
           AND definitive = 0 AND error_code IS NULL
           AND next_attempt_at = ?
       )`,
    readyAt,
  );
  for (const [table, surface, identity] of [
    ["github_feedback_bundles", "aggregate_feedback", "evaluation_id"],
    ["github_finding_feedback", "inline_feedback", "finding_id"],
  ]) {
    transaction.run(
      `UPDATE ${table}
       SET publication_status = 'waiting',
           external_id = NULL,
           published_at = NULL,
           error_code = NULL,
           error_detail = NULL
       WHERE publication_status = 'unavailable'
         AND EXISTS (
           SELECT 1 FROM github_delivery_attempts
           WHERE surface = ? AND source_id = ${table}.${identity}
             AND definitive = 0 AND error_code IS NULL
             AND next_attempt_at = ?
         )`,
      surface,
      readyAt,
    );
  }
  transaction.run(
    "DELETE FROM github_delivery_provider_gates WHERE connection_id = ?",
    connectionId,
  );
}
