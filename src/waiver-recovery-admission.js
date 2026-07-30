import {
  failEvaluation,
  failEvaluationUnavailable,
} from "./evaluation-validation.js";

/**
 * @param {any} access
 * @param {string} repositoryId
 * @param {number} recoveryTime
 * @param {boolean} requireNewWork
 */
export function assertWaiverRecoveryRepositoryAvailable(
  access,
  repositoryId,
  recoveryTime,
  requireNewWork,
) {
  const repository = access.get(
    `SELECT repositories.lifecycle, repositories.health,
            repositories.health_error_code,
            repositories.health_error_message,
            COALESCE(
              github_connections.health,
              forgejo_connections.health
            ) AS connection_health,
            CASE
              WHEN github_repositories.repository_id IS NOT NULL
                THEN github_connections.health_error_code
              WHEN forgejo_repositories.repository_id IS NOT NULL
                THEN COALESCE(
                  (
                    SELECT error_code
                    FROM forgejo_connection_verifications
                    WHERE connection_id = forgejo_connections.id
                    ORDER BY rowid DESC
                    LIMIT 1
                  ),
                  json_extract((
                    SELECT value FROM quality_bar_metadata
                    WHERE key =
                      'forgejo_poll_gate:' || forgejo_connections.id
                  ), '$.code')
                )
              ELSE NULL
            END AS connection_error_code,
            CASE
              WHEN github_repositories.repository_id IS NOT NULL
                THEN github_connections.health_error_message
              WHEN forgejo_repositories.repository_id IS NOT NULL
                THEN COALESCE(
                  (
                    SELECT error_message
                    FROM forgejo_connection_verifications
                    WHERE connection_id = forgejo_connections.id
                    ORDER BY rowid DESC
                    LIMIT 1
                  ),
                  json_extract((
                    SELECT value FROM quality_bar_metadata
                    WHERE key =
                      'forgejo_poll_gate:' || forgejo_connections.id
                  ), '$.message')
                )
              ELSE NULL
            END AS connection_error_detail,
            COALESCE(
              github_repository_polls.rate_gate_until,
              forgejo_repository_polls.rate_gate_until
            ) AS rate_gate_until,
            COALESCE(
              github_repository_polls.error_code,
              forgejo_repository_polls.error_code
            ) AS rate_error_code,
            COALESCE(
              github_repository_polls.error_message,
              forgejo_repository_polls.error_message
            ) AS rate_error_detail
     FROM repositories
     LEFT JOIN github_repositories
       ON github_repositories.repository_id = repositories.id
     LEFT JOIN github_connections
       ON github_connections.id = github_repositories.connection_id
     LEFT JOIN github_repository_polls
       ON github_repository_polls.connection_id =
            github_repositories.connection_id
      AND github_repository_polls.forge_repository_id =
            github_repositories.forge_repository_id
     LEFT JOIN forgejo_repositories
       ON forgejo_repositories.repository_id = repositories.id
     LEFT JOIN forgejo_connections
       ON forgejo_connections.id = forgejo_repositories.connection_id
     LEFT JOIN forgejo_repository_polls
       ON forgejo_repository_polls.connection_id =
            forgejo_repositories.connection_id
      AND forgejo_repository_polls.forge_repository_id =
            forgejo_repositories.forge_repository_id
     WHERE repositories.id = ?`,
    repositoryId,
  );
  if (!repository) {
    failEvaluation("repository_not_found", "Repository was not found");
  }
  if (requireNewWork && repository.lifecycle !== "enabled") {
    failEvaluation(
      `repository_${repository.lifecycle}`,
      "Repository does not accept new work",
    );
  }
  if (repository.health !== "healthy") {
    failEvaluationUnavailable(
      repository.health_error_code,
      repository.health_error_message,
    );
  }
  if (repository.connection_health === "error") {
    failEvaluationUnavailable(
      repository.connection_error_code,
      repository.connection_error_detail,
    );
  }
  if (
    Number.isSafeInteger(repository.rate_gate_until) &&
    repository.rate_gate_until > recoveryTime
  ) {
    failEvaluationUnavailable(
      repository.rate_error_code,
      repository.rate_error_detail,
    );
  }
}
