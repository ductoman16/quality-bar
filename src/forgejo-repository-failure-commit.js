/** @param {unknown} error */
export function codedForgejoRepositoryFailure(error) {
  if (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.length > 0
  ) {
    return /** @type {Error & {attemptedAt?: number, code: string, repositoryChecks?: unknown, repositoryId?: number, verificationEvidence?: any}} */ (
      error
    );
  }
  throw error;
}

/**
 * @param {number[]} repositoryIds
 * @param {{code: string, message: string, repositoryId?: unknown}} error
 * @param {any[]} repositoryChecks
 */
export function resolveForgejoRepositoryFailureOwner(
  repositoryIds,
  error,
  repositoryChecks,
) {
  const checkedOwners = repositoryChecks
    .filter((check) => check.outcome === "error")
    .map((check) => Number(check.forge_repository_id));
  const explicitOwner = Number.isSafeInteger(error.repositoryId)
    ? Number(error.repositoryId)
    : undefined;
  if (
    checkedOwners.length > 1 ||
    (error.repositoryId !== undefined && explicitOwner === undefined) ||
    (explicitOwner !== undefined && !repositoryIds.includes(explicitOwner))
  ) {
    return undefined;
  }
  const checkedOwner =
    checkedOwners.length === 1 ? checkedOwners[0] : undefined;
  const checkedFailure =
    checkedOwners.length === 1
      ? repositoryChecks.find((check) => check.outcome === "error")
      : undefined;
  if (
    explicitOwner !== undefined &&
    checkedOwner !== undefined &&
    explicitOwner !== checkedOwner
  ) {
    return undefined;
  }
  if (
    checkedFailure &&
    (checkedFailure.error?.code !== error.code ||
      checkedFailure.error?.message !== error.message)
  ) {
    return undefined;
  }
  return checkedOwner ?? explicitOwner;
}

/**
 * @param {any} transaction
 * @param {{code: string, message: string}} error
 * @param {string} connectionId
 * @param {number} forgeRepositoryId
 * @param {string} verificationId
 * @param {number} verifiedAt
 */
export function commitForgejoRepositoryFailure(
  transaction,
  error,
  connectionId,
  forgeRepositoryId,
  verificationId,
  verifiedAt,
) {
  const repositoryUpdate = transaction.run(
    `UPDATE repositories
     SET verified_at = ?,
         health = 'error',
         health_error_code = ?,
         health_error_message = ?
     WHERE id = (
       SELECT repository_id
       FROM forgejo_repositories
       WHERE connection_id = ? AND forge_repository_id = ?
     )`,
    verifiedAt,
    error.code,
    error.message,
    connectionId,
    forgeRepositoryId,
  );
  const mappingUpdate = transaction.run(
    `UPDATE forgejo_repositories
     SET verification_id = ?
     WHERE connection_id = ? AND forge_repository_id = ?`,
    verificationId,
    connectionId,
    forgeRepositoryId,
  );
  return repositoryUpdate.changes === 1 && mappingUpdate.changes === 1;
}
