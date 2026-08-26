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
    "forgejo_publication_capability_unavailable",
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

export function resumeForgejoDeliveries(
  transaction: any,
  connectionId: string,
  readyAt: number,
  correction: keyof typeof CORRECTABLE_FAILURES,
  repositoryIds?: number[],
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
  transaction.run(
    `UPDATE forgejo_delivery_attempts
     SET generation = generation + 1, next_attempt_at = ?,
         error_code = NULL, error_detail = NULL, response_status = NULL,
         definitive = 0
     WHERE definitive = 1 AND connection_id = ?
       AND source_id GLOB 'waiver-*'
       AND error_code IN (${correctableFailures.map(() => "?").join(", ")})${scope}`,
    readyAt,
    connectionId,
    ...correctableFailures,
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
  for (const [table, surface, identity, prefix] of [
    [
      "forgejo_waiver_adjudication_followups",
      "aggregate_feedback",
      "waiver_adjudication_id",
      "waiver-adjudication:",
    ],
    [
      "forgejo_waiver_decision_followups",
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
           SELECT 1 FROM forgejo_delivery_attempts
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
}

export function resumeForgejoRepositoryDeliveries(
  transaction: any,
  connectionId: string,
  readyAt: number,
  repositoryIds: number[],
) {
  resumeForgejoDeliveries(
    transaction,
    connectionId,
    readyAt,
    "repository_authority",
    repositoryIds,
  );
}
