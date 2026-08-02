export const REPOSITORY_SELECTION = `SELECT
  repositories.id,
  repositories.normalized_url,
  repositories.lifecycle,
  repositories.lifecycle_revision,
  repositories.has_been_used,
  repositories.health,
  repositories.health_error_code,
  repositories.health_error_message,
  repositories.verified_at,
  COALESCE(github_repositories.connection_id, forgejo_repositories.connection_id) AS forge_connection_id,
  COALESCE(github_repositories.verification_id, forgejo_repositories.verification_id) AS verification_id,
  COALESCE(github_repositories.forge_repository_id, forgejo_repositories.forge_repository_id) AS forge_repository_id,
  COALESCE(github_repositories.name, forgejo_repositories.name) AS forge_name,
  COALESCE(github_repositories.api_url, forgejo_repositories.api_url) AS forge_api_url,
  COALESCE(github_repositories.web_url, forgejo_repositories.web_url) AS forge_web_url,
  CASE WHEN github_repositories.repository_id IS NOT NULL THEN 'github' WHEN forgejo_repositories.repository_id IS NOT NULL THEN 'forgejo' ELSE NULL END AS forge_provider,
  COALESCE(github_connections.health, forgejo_connections.health) AS forge_connection_health,
  CASE
    WHEN github_repositories.repository_id IS NOT NULL
      THEN github_connections.health_error_code
    WHEN forgejo_repositories.repository_id IS NOT NULL
      THEN COALESCE(
        (SELECT error_code FROM forgejo_delivery_attempts
         WHERE connection_id = forgejo_connections.id AND definitive = 1
           AND error_code IN (
             'forgejo_connection_credential_invalid',
             'forgejo_connection_credential_undecryptable',
             'forgejo_publication_capability_unavailable',
             'forgejo_required_route_unavailable',
             'forgejo_version_unsupported'
           )
         ORDER BY last_attempt_at DESC, rowid DESC LIMIT 1),
        (SELECT error_code FROM forgejo_connection_verifications
         WHERE connection_id = forgejo_connections.id
           AND error_code IS NOT NULL
           AND error_code NOT IN (
             'forgejo_poll_response_invalid',
             'forgejo_repository_api_access_failed',
             'forgejo_repository_capability_missing',
             'forgejo_repository_permission_denied',
             'forgejo_repository_selection_unavailable',
             'repository_git_read_failed',
             'repository_git_verification_unavailable'
           )
         ORDER BY rowid DESC LIMIT 1),
        json_extract((SELECT value FROM quality_bar_metadata
          WHERE key = 'forgejo_poll_gate:' || forgejo_connections.id), '$.code')
      )
    ELSE NULL
  END AS forge_connection_health_error_code,
  CASE
    WHEN github_repositories.repository_id IS NOT NULL
      THEN github_connections.health_error_message
    WHEN forgejo_repositories.repository_id IS NOT NULL
      THEN COALESCE(
        (SELECT error_detail FROM forgejo_delivery_attempts
         WHERE connection_id = forgejo_connections.id AND definitive = 1
           AND error_code IN (
             'forgejo_connection_credential_invalid',
             'forgejo_connection_credential_undecryptable',
             'forgejo_publication_capability_unavailable',
             'forgejo_required_route_unavailable',
             'forgejo_version_unsupported'
           )
         ORDER BY last_attempt_at DESC, rowid DESC LIMIT 1),
        (SELECT error_message FROM forgejo_connection_verifications
         WHERE connection_id = forgejo_connections.id
           AND error_code IS NOT NULL
           AND error_code NOT IN (
             'forgejo_poll_response_invalid',
             'forgejo_repository_api_access_failed',
             'forgejo_repository_capability_missing',
             'forgejo_repository_permission_denied',
             'forgejo_repository_selection_unavailable',
             'repository_git_read_failed',
             'repository_git_verification_unavailable'
           )
         ORDER BY rowid DESC LIMIT 1),
        json_extract((SELECT value FROM quality_bar_metadata
          WHERE key = 'forgejo_poll_gate:' || forgejo_connections.id), '$.message')
      )
    ELSE NULL
  END AS forge_connection_health_error_message,
  (
    SELECT count(*)
    FROM review_assignment_repositories
    WHERE review_assignment_repositories.repository_id = repositories.id
  ) AS assignment_count,
  repository_credentials.encrypted_credential
FROM repositories
LEFT JOIN github_repositories
  ON github_repositories.repository_id = repositories.id
LEFT JOIN github_connections
  ON github_connections.id = github_repositories.connection_id
LEFT JOIN forgejo_repositories
  ON forgejo_repositories.repository_id = repositories.id
LEFT JOIN forgejo_connections
  ON forgejo_connections.id = forgejo_repositories.connection_id
LEFT JOIN repository_credentials
  ON repository_credentials.repository_id = repositories.id`;

/** @param {Record<string, import("node:sqlite").SQLInputValue> | undefined} row */
export function readRepositoryResource(row) {
  if (
    !row ||
    typeof row.id !== "string" ||
    typeof row.normalized_url !== "string" ||
    ![0, 1].includes(/** @type {number} */ (row.has_been_used)) ||
    !["enabled", "disabled", "retired"].includes(
      /** @type {string} */ (row.lifecycle),
    ) ||
    !["healthy", "error"].includes(/** @type {string} */ (row.health))
  ) {
    throw new TypeError("Repository row is invalid");
  }
  const healthError =
    row.health === "error"
      ? {
          code: /** @type {string} */ (row.health_error_code),
          message: /** @type {string} */ (row.health_error_message),
        }
      : null;
  if (
    row.health === "error" &&
    (typeof healthError?.code !== "string" ||
      typeof healthError.message !== "string")
  ) {
    throw new TypeError("Repository health error is invalid");
  }
  const repository = {
    credential_type:
      typeof row.forge_connection_id === "string"
        ? "forge_connection"
        : typeof row.encrypted_credential === "string"
          ? "username_token"
          : "none",
    deletion_eligible: row.has_been_used === 0,
    health: /** @type {"healthy" | "error"} */ (row.health),
    health_error: healthError,
    id: row.id,
    lifecycle: /** @type {"enabled" | "disabled" | "retired"} */ (
      row.lifecycle
    ),
    url: row.normalized_url,
  };
  if (typeof row.forge_connection_id !== "string") {
    return repository;
  }
  if (
    !Number.isSafeInteger(row.forge_repository_id) ||
    typeof row.forge_name !== "string" ||
    typeof row.forge_api_url !== "string" ||
    typeof row.forge_web_url !== "string" ||
    !["github", "forgejo"].includes(
      /** @type {string} */ (row.forge_provider),
    ) ||
    typeof row.verification_id !== "string" ||
    !Number.isSafeInteger(row.verified_at) ||
    !Number.isSafeInteger(row.assignment_count)
  ) {
    throw new TypeError("GitHub Repository row is invalid");
  }
  return {
    ...repository,
    api_url: row.forge_api_url,
    assignment_count: row.assignment_count,
    forge_connection_id: row.forge_connection_id,
    forge_repository_id: /** @type {number} */ (row.forge_repository_id),
    name: row.forge_name,
    provider: /** @type {"github" | "forgejo"} */ (row.forge_provider),
    verification_id: row.verification_id,
    verified_at: row.verified_at,
    web_url: row.forge_web_url,
  };
}
