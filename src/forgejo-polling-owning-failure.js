import { isDefinitiveForgejoPollingFailure } from "./forgejo-polling.js";

/** @param {any} transaction @param {string} connectionId @param {number[]} forgeRepositoryIds @param {Error & {code: string, repositoryId?: number}} failure @param {number} attemptedAt */
export function recordForgejoPollingOwningFailure(
  transaction,
  connectionId,
  forgeRepositoryIds,
  failure,
  attemptedAt,
) {
  if (!isDefinitiveForgejoPollingFailure(failure)) {
    return;
  }
  const repositoryFailure = new Set([
    "forgejo_poll_response_invalid",
    "forgejo_repository_api_access_failed",
    "forgejo_repository_permission_denied",
    "repository_permission_denied",
    "repository_git_read_failed",
  ]);
  const repositoryId =
    repositoryFailure.has(failure.code) &&
    Number.isSafeInteger(failure.repositoryId) &&
    forgeRepositoryIds.includes(Number(failure.repositoryId))
      ? Number(failure.repositoryId)
      : null;
  if (repositoryId !== null) {
    transaction.run(
      `UPDATE repositories
          SET health = 'error', health_error_code = ?,
              health_error_message = ?, verified_at = ?
        WHERE id = (
          SELECT repository_id FROM forgejo_repositories
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
    "UPDATE forgejo_connections SET health = 'error', verified_at = ? WHERE id = ?",
    attemptedAt,
    connectionId,
  );
}
