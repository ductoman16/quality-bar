import { isDefinitiveGitHubPollingFailure } from "./github-polling.js";

/** @param {any} transaction @param {string} connectionId @param {number[]} forgeRepositoryIds @param {Error & {code: string, repositoryId?: number}} failure @param {number} attemptedAt */
export function recordGitHubPollingOwningFailure(
  transaction,
  connectionId,
  forgeRepositoryIds,
  failure,
  attemptedAt,
) {
  if (!isDefinitiveGitHubPollingFailure(failure)) {
    return;
  }
  const repositoryId = Number.isSafeInteger(failure.repositoryId)
    ? /** @type {number} */ (failure.repositoryId)
    : failure.code === "github_repository_api_access_failed" &&
        forgeRepositoryIds.length === 1
      ? forgeRepositoryIds[0]
      : null;
  if (repositoryId !== null && forgeRepositoryIds.includes(repositoryId)) {
    transaction.run(
      `UPDATE repositories
            SET health = 'error', health_error_code = ?,
                health_error_message = ?, verified_at = ?
          WHERE id = (
            SELECT repository_id FROM github_repositories
             WHERE connection_id = ? AND forge_repository_id = ?
          )`,
      failure.code,
      failure.message,
      attemptedAt,
      connectionId,
      repositoryId,
    );
    return;
  }
  transaction.run(
    `UPDATE github_connections
          SET health = 'error', health_error_code = ?,
              health_error_message = ?, verified_at = ?
        WHERE id = ?`,
    failure.code,
    failure.message,
    attemptedAt,
    connectionId,
  );
}
