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
}
