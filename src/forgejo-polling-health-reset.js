/** @param {any} transaction */
export function resetForgejoPollingHealth(transaction) {
  transaction.run(
    `UPDATE repositories
     SET health = 'healthy', health_error_code = NULL,
         health_error_message = NULL
     WHERE id IN (SELECT repository_id FROM forgejo_repositories)
       AND health_error_code IN (
         'forgejo_poll_response_invalid',
         'forgejo_repository_api_access_failed',
         'forgejo_repository_permission_denied'
       )
       AND NOT EXISTS (
         SELECT 1 FROM forgejo_delivery_attempts
         WHERE definitive = 1
           AND error_code IN (
             'forgejo_repository_api_access_failed',
             'forgejo_repository_capability_missing',
             'forgejo_repository_permission_denied'
           )
           AND source_id IN (
             SELECT evaluation_id || ':' || desired_state
             FROM forgejo_commit_statuses
             WHERE repository_id = repositories.id
             UNION ALL
             SELECT evaluation_id FROM forgejo_automatic_evaluations
             WHERE repository_id = repositories.id
             UNION ALL
             SELECT forgejo_finding_feedback.finding_id
             FROM forgejo_finding_feedback
             JOIN forgejo_automatic_evaluations
               ON forgejo_automatic_evaluations.evaluation_id =
                    forgejo_finding_feedback.evaluation_id
             WHERE forgejo_automatic_evaluations.repository_id = repositories.id
           )
       )`,
  );
  transaction.run(
    `UPDATE forgejo_connections SET health = 'healthy'
     WHERE lifecycle = 'enabled'
       AND (
         SELECT error_code FROM forgejo_connection_verifications
         WHERE connection_id = forgejo_connections.id
         ORDER BY rowid DESC LIMIT 1
       ) IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM forgejo_delivery_attempts
         WHERE connection_id = forgejo_connections.id
           AND definitive = 1
           AND error_code IN (
             'forgejo_connection_credential_invalid',
             'forgejo_connection_credential_undecryptable',
             'forgejo_publication_capability_unavailable',
             'forgejo_required_route_unavailable',
             'forgejo_version_unsupported'
           )
       )`,
  );
}
