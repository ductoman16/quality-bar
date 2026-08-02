/** @param {{run: (sql: string, ...parameters: any[]) => unknown}} transaction @param {string} connectionId */
export function retireForgejoPublicationRows(transaction, connectionId) {
  transaction.run(
    `UPDATE forgejo_commit_statuses
     SET publication_status = 'unavailable',
         published_state = NULL,
         published_at = NULL,
         external_id = NULL,
         error_code = 'forgejo_connection_retired',
         error_detail = 'Forgejo commit status publication is unavailable because the Forgejo Connection is retired'
     WHERE publication_status = 'waiting'
       AND repository_id IN (
         SELECT repository_id FROM forgejo_repositories
         WHERE connection_id = ?
       )`,
    connectionId,
  );
  transaction.run(
    `UPDATE forgejo_feedback_bundles
     SET publication_status = 'unavailable',
         external_id = NULL,
         published_at = NULL,
         error_code = 'forgejo_connection_retired',
         error_detail = 'Forgejo feedback publication is unavailable because the Forgejo Connection is retired'
     WHERE publication_status = 'waiting'
       AND evaluation_id IN (
         SELECT forgejo_automatic_evaluations.evaluation_id
         FROM forgejo_automatic_evaluations
         JOIN forgejo_repositories
           ON forgejo_repositories.repository_id =
                forgejo_automatic_evaluations.repository_id
         WHERE forgejo_repositories.connection_id = ?
       )`,
    connectionId,
  );
  transaction.run(
    `UPDATE forgejo_finding_feedback
     SET publication_status = 'unavailable',
         external_id = NULL,
         published_at = NULL,
         error_code = 'forgejo_connection_retired',
         error_detail = 'Forgejo inline feedback publication is unavailable because the Forgejo Connection is retired'
     WHERE publication_status = 'waiting'
       AND evaluation_id IN (
         SELECT forgejo_automatic_evaluations.evaluation_id
         FROM forgejo_automatic_evaluations
         JOIN forgejo_repositories
           ON forgejo_repositories.repository_id =
                forgejo_automatic_evaluations.repository_id
         WHERE forgejo_repositories.connection_id = ?
       )`,
    connectionId,
  );
  transaction.run(
    `UPDATE forgejo_delivery_attempts
     SET generation = generation + 1, next_attempt_at = 0,
         connection_id = ?, authority_verified_at = (
           SELECT verified_at FROM forgejo_connections WHERE id = ?
         ),
         error_code = 'forgejo_connection_retired',
         error_detail =
           'Forgejo delivery is unavailable because the Forgejo Connection is retired',
         response_status = NULL, definitive = 1
     WHERE
       (surface = 'commit_status' AND source_id IN (
         SELECT evaluation_id || ':' || desired_state
         FROM forgejo_commit_statuses
         WHERE publication_status = 'unavailable'
           AND error_code = 'forgejo_connection_retired'
           AND repository_id IN (
           SELECT repository_id FROM forgejo_repositories
           WHERE connection_id = ?
         )
       ))
       OR (surface = 'aggregate_feedback' AND source_id IN (
         SELECT forgejo_automatic_evaluations.evaluation_id
         FROM forgejo_automatic_evaluations
         JOIN forgejo_repositories
           ON forgejo_repositories.repository_id =
                forgejo_automatic_evaluations.repository_id
         JOIN forgejo_feedback_bundles
           ON forgejo_feedback_bundles.evaluation_id =
                forgejo_automatic_evaluations.evaluation_id
         WHERE forgejo_repositories.connection_id = ?
           AND forgejo_feedback_bundles.publication_status = 'unavailable'
           AND forgejo_feedback_bundles.error_code =
                 'forgejo_connection_retired'
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
         WHERE forgejo_repositories.connection_id = ?
           AND forgejo_finding_feedback.publication_status = 'unavailable'
           AND forgejo_finding_feedback.error_code =
                 'forgejo_connection_retired'
       ))`,
    connectionId,
    connectionId,
    connectionId,
    connectionId,
    connectionId,
  );
  transaction.run(
    `DELETE FROM forgejo_delivery_provider_gates WHERE connection_id = ?`,
    connectionId,
  );
}
