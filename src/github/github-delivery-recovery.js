/**
 * @param {any} transaction
 * @param {string} connectionId
 * @param {number} readyAt
 * @param {number[]} [repositoryIds]
 */
export function resumeGitHubDeliveries(
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
    throw new TypeError("GitHub delivery recovery scope is invalid");
  }
  if (repositoryIds?.length === 0) {
    return;
  }
  const repositoryScope = repositoryIds
    ? ` AND forge_repository_id IN (${repositoryIds.map(() => "?").join(", ")})`
    : "";
  const repositoryParameters = repositoryIds ?? [];
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
             WHERE connection_id = ?${repositoryScope}
           )
         ))
         OR
         (surface = 'aggregate_feedback' AND source_id IN (
           SELECT github_automatic_evaluations.evaluation_id
           FROM github_automatic_evaluations
           JOIN github_repositories
             ON github_repositories.repository_id =
                  github_automatic_evaluations.repository_id
           WHERE github_repositories.connection_id = ?${repositoryScope}
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
           WHERE github_repositories.connection_id = ?${repositoryScope}
         ))
       )`,
    readyAt,
    connectionId,
    ...repositoryParameters,
    connectionId,
    ...repositoryParameters,
    connectionId,
    ...repositoryParameters,
  );
  transaction.run(
    `UPDATE github_delivery_attempts
     SET generation = generation + 1, next_attempt_at = ?,
         error_code = NULL, error_detail = NULL, response_status = NULL,
         definitive = 0
     WHERE definitive = 1 AND connection_id = ?
       AND source_id GLOB 'waiver-*'
       AND (error_code IN (
         'github_app_profile_mismatch',
         'github_connection_credential_invalid',
         'github_connection_credential_undecryptable',
         'github_connection_retired',
         'github_installation_scope_invalid',
         'github_permissions_mismatch',
         'github_principal_mismatch',
         'github_repository_api_access_failed'
       ) OR (error_code = 'github_api_request_failed'
             AND response_status IN (401, 403)))
       ${repositoryIds ? `AND json_extract(target, '$.repository_id') IN (${repositoryIds.map(() => "?").join(", ")})` : ""}`,
    readyAt,
    connectionId,
    ...repositoryParameters,
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
  for (const [table, surface, identity, prefix] of [
    [
      "github_waiver_adjudication_followups",
      "aggregate_feedback",
      "waiver_adjudication_id",
      "waiver-adjudication:",
    ],
    [
      "github_waiver_decision_followups",
      "inline_feedback",
      "waiver_decision_id",
      "waiver-decision:",
    ],
  ]) {
    transaction.run(
      `UPDATE ${table}
       SET publication_status = 'waiting', external_id = NULL,
           published_at = NULL, error_code = NULL, error_detail = NULL
       WHERE publication_status = 'unavailable'
         AND EXISTS (
           SELECT 1 FROM github_delivery_attempts
           WHERE surface = ?
             AND source_id ${surface === "inline_feedback" ? `= ? || ${table}.${identity} || ':' || ${table}.finding_id` : `= ? || ${table}.${identity}`}
             AND definitive = 0 AND error_code IS NULL
             AND next_attempt_at = ?
         )`,
      surface,
      prefix,
      readyAt,
    );
  }
  transaction.run(
    `DELETE FROM github_delivery_provider_gates
     WHERE connection_id = ? AND gate_until <= ?`,
    connectionId,
    readyAt,
  );
}
