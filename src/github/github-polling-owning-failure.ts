import { isDefinitiveGitHubPollingFailure } from "./github-polling.ts";

export function recordGitHubPollingOwningFailure(
  transaction: any,
  connectionId: string,
  forgeRepositoryIds: number[],
  failure: Error & { code: string; repositoryId?: number },
  attemptedAt: number,
) {
  if (!isDefinitiveGitHubPollingFailure(failure)) {
    return;
  }
  const repositoryId = Number.isSafeInteger(failure.repositoryId)
    ? (failure.repositoryId as number)
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
