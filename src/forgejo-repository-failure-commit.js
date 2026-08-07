import { forgejoFailureRepositoryIds } from "./forgejo-failure.js";

/** @returns {never} */
function invalidFailureOwnership() {
  throw Object.assign(
    new Error("Forgejo Repository failure ownership is inconsistent"),
    { code: "forgejo_verification_result_invalid" },
  );
}

/** @param {unknown} error */
export function codedForgejoRepositoryFailure(error) {
  if (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.length > 0
  ) {
    return /** @type {Error & {attemptedAt?: number, code: string, repositoryChecks?: unknown, repositoryId?: number, repositoryIds?: number[], verificationEvidence?: any}} */ (
      error
    );
  }
  throw error;
}

/**
 * @param {number[]} repositoryIds
 * @param {{code: string, message: string, repositoryId?: number, repositoryIds?: number[]}} error
 * @param {any[]} repositoryChecks
 */
export function normalizeForgejoRepositoryFailureOwners(
  repositoryIds,
  error,
  repositoryChecks,
) {
  /** @param {number[]} owners */
  const normalize = (owners) => {
    delete error.repositoryId;
    delete error.repositoryIds;
    if (owners.length === 1) {
      error.repositoryId = owners[0];
    } else if (owners.length > 1) {
      error.repositoryIds = owners;
    }
    return owners;
  };
  const checkedOwners = repositoryChecks
    .filter((check) => check.outcome === "error")
    .map((check) => Number(check.forge_repository_id));
  const explicitOwners = forgejoFailureRepositoryIds(error);
  if (
    checkedOwners.some(
      (repositoryId) =>
        !Number.isSafeInteger(repositoryId) ||
        repositoryId <= 0 ||
        !repositoryIds.includes(repositoryId),
    ) ||
    new Set(checkedOwners).size !== checkedOwners.length ||
    explicitOwners.some((repositoryId) => !repositoryIds.includes(repositoryId))
  ) {
    invalidFailureOwnership();
  }
  if (
    explicitOwners.length > 0 &&
    checkedOwners.length > 0 &&
    (explicitOwners.length !== checkedOwners.length ||
      explicitOwners.some(
        (repositoryId) => !checkedOwners.includes(repositoryId),
      ))
  ) {
    invalidFailureOwnership();
  }
  for (const checkedFailure of repositoryChecks.filter(
    (check) => check.outcome === "error",
  )) {
    if (
      checkedFailure.error?.code !== error.code ||
      checkedFailure.error?.message !== error.message
    ) {
      invalidFailureOwnership();
    }
  }
  const owners = checkedOwners.length > 0 ? checkedOwners : explicitOwners;
  return normalize(owners);
}

/** @param {any} transaction @param {{code: string, message: string}} error @param {string} connectionId @param {number[]} forgeRepositoryIds @param {string} verificationId @param {number} verifiedAt */
export function commitForgejoRepositoryFailures(
  transaction,
  error,
  connectionId,
  forgeRepositoryIds,
  verificationId,
  verifiedAt,
) {
  return forgeRepositoryIds.every((forgeRepositoryId) =>
    commitForgejoRepositoryFailure(
      transaction,
      error,
      connectionId,
      forgeRepositoryId,
      verificationId,
      verifiedAt,
    ),
  );
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
