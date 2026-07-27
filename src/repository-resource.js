export const REPOSITORY_SELECTION = `SELECT
  repositories.id,
  repositories.normalized_url,
  repositories.lifecycle,
  repositories.health,
  repositories.health_error_code,
  repositories.health_error_message,
  repositories.verified_at,
  github_repositories.connection_id AS forge_connection_id,
  github_repositories.forge_repository_id,
  github_repositories.name AS github_name,
  github_repositories.api_url AS github_api_url,
  github_repositories.web_url AS github_web_url,
  (
    SELECT count(*)
    FROM review_assignment_repositories
    WHERE review_assignment_repositories.repository_id = repositories.id
  ) AS assignment_count,
  repository_credentials.encrypted_credential
FROM repositories
LEFT JOIN github_repositories
  ON github_repositories.repository_id = repositories.id
LEFT JOIN repository_credentials
  ON repository_credentials.repository_id = repositories.id`;

/** @param {Record<string, import("node:sqlite").SQLInputValue> | undefined} row */
export function readRepositoryResource(row) {
  if (
    !row ||
    typeof row.id !== "string" ||
    typeof row.normalized_url !== "string" ||
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
    typeof row.github_name !== "string" ||
    typeof row.github_api_url !== "string" ||
    typeof row.github_web_url !== "string" ||
    !Number.isSafeInteger(row.verified_at) ||
    !Number.isSafeInteger(row.assignment_count)
  ) {
    throw new TypeError("GitHub Repository row is invalid");
  }
  return {
    ...repository,
    api_url: row.github_api_url,
    assignment_count: row.assignment_count,
    forge_connection_id: row.forge_connection_id,
    forge_repository_id: /** @type {number} */ (row.forge_repository_id),
    name: row.github_name,
    provider: "github",
    verified_at: row.verified_at,
    web_url: row.github_web_url,
  };
}
