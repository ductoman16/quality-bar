import { GitHubConnectionError } from "./github-connection-error.ts";

function unavailable(): never {
  throw new GitHubConnectionError(
    "github_connection_not_found",
    "GitHub Connection is not configured",
  );
}

export function readGitHubRepositorySelectionSnapshot(durableCore: {
  all: Function;
}) {
  const [connection] = durableCore.all(
    `SELECT github_connections.id, github_connections.app_id,
            github_connections.app_slug, github_connections.installation_id,
            github_connections.principal_id,
            github_connections.principal_login,
            github_connections.api_profile, github_connections.permissions,
            github_connections.capabilities, github_connections.lifecycle,
            github_connections.health, github_connections.health_error_code,
            github_connections.health_error_message,
            github_connections.repository_count,
            github_connections.verified_at,
            (
              SELECT id FROM github_connection_verifications
               WHERE connection_id = github_connections.id
               ORDER BY rowid DESC LIMIT 1
            ) AS latest_verification_id,
            github_connection_credentials.encrypted_credential
       FROM github_connections
       JOIN github_connection_credentials
         ON github_connection_credentials.connection_id = github_connections.id
       LIMIT 1`,
  );
  if (
    !connection ||
    typeof connection.id !== "string" ||
    !Number.isSafeInteger(connection.app_id) ||
    typeof connection.app_slug !== "string" ||
    !Number.isSafeInteger(connection.installation_id) ||
    !Number.isSafeInteger(connection.principal_id) ||
    typeof connection.principal_login !== "string" ||
    typeof connection.api_profile !== "string" ||
    typeof connection.permissions !== "string" ||
    typeof connection.capabilities !== "string" ||
    connection.lifecycle !== "enabled" ||
    !["error", "healthy"].includes(connection.health) ||
    (connection.health_error_code !== null &&
      typeof connection.health_error_code !== "string") ||
    (connection.health_error_message !== null &&
      typeof connection.health_error_message !== "string") ||
    !Number.isSafeInteger(connection.repository_count) ||
    !Number.isSafeInteger(connection.verified_at) ||
    typeof connection.latest_verification_id !== "string" ||
    typeof connection.encrypted_credential !== "string"
  ) {
    unavailable();
  }
  const existing = new Map<number, any>(
    durableCore
      .all(
        `SELECT github_repositories.repository_id,
                github_repositories.forge_repository_id,
                github_repositories.verification_id,
                github_repositories.name, github_repositories.api_url,
                github_repositories.web_url, repositories.lifecycle,
                repositories.lifecycle_revision, repositories.health,
                repositories.health_error_code,
                repositories.health_error_message, repositories.verified_at
           FROM github_repositories
           JOIN repositories
             ON repositories.id = github_repositories.repository_id
          WHERE connection_id = ?`,
        connection.id,
      )
      .map((row: any) => {
        if (
          !row ||
          typeof row.repository_id !== "string" ||
          !Number.isSafeInteger(row.forge_repository_id) ||
          !["enabled", "disabled", "retired"].includes(
            row.lifecycle as string,
          ) ||
          !Number.isSafeInteger(row.lifecycle_revision) ||
          !["error", "healthy"].includes(row.health as string) ||
          (row.health_error_code !== null &&
            typeof row.health_error_code !== "string") ||
          (row.health_error_message !== null &&
            typeof row.health_error_message !== "string") ||
          !Number.isSafeInteger(row.verified_at) ||
          typeof row.verification_id !== "string" ||
          typeof row.name !== "string" ||
          typeof row.api_url !== "string" ||
          typeof row.web_url !== "string"
        ) {
          throw new TypeError("GitHub Repository identity row is invalid");
        }
        return [
          Number(row.forge_repository_id),
          {
            apiUrl: row.api_url,
            health: row.health,
            healthErrorCode: row.health_error_code,
            healthErrorMessage: row.health_error_message,
            id: row.repository_id,
            lifecycle: row.lifecycle,
            lifecycleRevision: row.lifecycle_revision,
            name: row.name,
            verificationId: row.verification_id,
            verifiedAt: row.verified_at,
            webUrl: row.web_url,
          },
        ] as [number, any];
      }),
  );
  return { connection, existing };
}
