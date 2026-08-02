const CORRECTABLE_FAILURES = Object.freeze({
  connection_authority: [
    "forgejo_connection_credential_invalid",
    "forgejo_connection_credential_undecryptable",
    "forgejo_publication_capability_unavailable",
    "forgejo_required_route_unavailable",
    "forgejo_version_unsupported",
  ],
  connection_reactivation: [
    "forgejo_connection_credential_invalid",
    "forgejo_connection_credential_undecryptable",
    "forgejo_connection_retired",
    "forgejo_repository_api_access_failed",
    "forgejo_repository_capability_missing",
    "forgejo_repository_permission_denied",
    "forgejo_required_route_unavailable",
    "forgejo_version_unsupported",
  ],
  repository_authority: [
    "forgejo_connection_credential_invalid",
    "forgejo_connection_credential_undecryptable",
    "forgejo_connection_retired",
    "forgejo_repository_api_access_failed",
    "forgejo_repository_capability_missing",
    "forgejo_repository_permission_denied",
    "forgejo_required_route_unavailable",
    "forgejo_version_unsupported",
  ],
});

/** @param {any} transaction @param {string} connectionId @param {number} readyAt @param {keyof typeof CORRECTABLE_FAILURES} correction @param {number[]} [repositoryIds] */
export function resumeForgejoDeliveries(
  transaction,
  connectionId,
  readyAt,
  correction,
  repositoryIds,
) {
  const correctableFailures = CORRECTABLE_FAILURES[correction];
  if (
    !correctableFailures ||
    (repositoryIds &&
      (new Set(repositoryIds).size !== repositoryIds.length ||
        repositoryIds.some(
          (repositoryId) =>
            !Number.isSafeInteger(repositoryId) || repositoryId <= 0,
        )))
  ) {
    throw new TypeError("Forgejo delivery recovery scope is invalid");
  }
  if (repositoryIds?.length === 0) {
    return;
  }
  const scope = repositoryIds
    ? ` AND json_extract(target, '$.repository_id') IN (${repositoryIds.map(() => "?").join(", ")})`
    : "";
  const parameters = repositoryIds ?? [];
  transaction.run(
    `UPDATE forgejo_delivery_attempts
     SET generation = generation + 1, next_attempt_at = ?,
         error_code = NULL, error_detail = NULL, response_status = NULL,
         definitive = 0
     WHERE definitive = 1
       AND error_code IN (${correctableFailures.map(() => "?").join(", ")})
       AND connection_id = ?${scope}`,
    readyAt,
    ...correctableFailures,
    connectionId,
    ...parameters,
  );
  if (repositoryIds) {
    transaction.run(
      `UPDATE repositories
       SET health = 'healthy', health_error_code = NULL,
           health_error_message = NULL, verified_at = ?
       WHERE id IN (
         SELECT repository_id FROM forgejo_repositories
         WHERE connection_id = ?
           AND forge_repository_id IN (${repositoryIds.map(() => "?").join(", ")})
       )
         AND health = 'error'
         AND health_error_code IN (${correctableFailures.map(() => "?").join(", ")})`,
      readyAt,
      connectionId,
      ...repositoryIds,
      ...correctableFailures,
    );
  }
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
}

/** @param {any} transaction @param {string} connectionId @param {number} readyAt @param {number[]} repositoryIds */
export function resumeForgejoRepositoryDeliveries(
  transaction,
  connectionId,
  readyAt,
  repositoryIds,
) {
  resumeForgejoDeliveries(
    transaction,
    connectionId,
    readyAt,
    "repository_authority",
    repositoryIds,
  );
}
