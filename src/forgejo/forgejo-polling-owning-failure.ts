import {
  forgejoDefinitiveFailureScope,
  forgejoFailureRepositoryIds,
} from "./forgejo-failure.ts";

export function recordForgejoPollingOwningFailure(
  transaction: any,
  connectionId: string,
  forgeRepositoryIds: number[],
  failure: Error & {
    code: string;
    repositoryId?: number;
    repositoryIds?: number[];
  },
  attemptedAt: number,
) {
  const scope = forgejoDefinitiveFailureScope(failure);
  if (scope === null) {
    return;
  }
  const repositoryIds =
    scope === "repository" ? forgejoFailureRepositoryIds(failure) : [];
  if (
    scope === "repository" &&
    (repositoryIds.length === 0 ||
      repositoryIds.some(
        (repositoryId) => !forgeRepositoryIds.includes(repositoryId),
      ))
  ) {
    throw Object.assign(
      new Error("Forgejo polling failure owner is not selected"),
      { code: "forgejo_poll_response_invalid" },
    );
  }
  for (const repositoryId of repositoryIds) {
    const update = transaction.run(
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
    if (update.changes !== 1) {
      throw Object.assign(
        new Error("Forgejo polling failure owner is not selected"),
        { code: "forgejo_poll_response_invalid" },
      );
    }
  }
  if (repositoryIds.length > 0) {
    return;
  }
  transaction.run(
    "UPDATE forgejo_connections SET health = 'error', verified_at = ? WHERE id = ?",
    attemptedAt,
    connectionId,
  );
}
