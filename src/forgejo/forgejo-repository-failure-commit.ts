import { forgejoFailureRepositoryIds } from "./forgejo-failure.ts";

function invalidFailureOwnership(): never {
  throw Object.assign(
    new Error("Forgejo Repository failure ownership is inconsistent"),
    { code: "forgejo_verification_result_invalid" },
  );
}

export function codedForgejoRepositoryFailure(error: unknown) {
  if (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.length > 0
  ) {
    return error as Error & {
      attemptedAt?: number;
      code: string;
      repositoryChecks?: unknown;
      repositoryId?: number;
      repositoryIds?: number[];
      verificationEvidence?: any;
    };
  }
  throw error;
}

export function normalizeForgejoRepositoryFailureOwners(
  repositoryIds: number[],
  error: {
    code: string;
    message: string;
    repositoryId?: number;
    repositoryIds?: number[];
  },
  repositoryChecks: any[],
) {
  const normalize = (owners: number[]) => {
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

export function commitForgejoRepositoryFailures(
  transaction: any,
  error: { code: string; message: string },
  connectionId: string,
  forgeRepositoryIds: number[],
  verificationId: string,
  verifiedAt: number,
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

export function commitForgejoRepositoryFailure(
  transaction: any,
  error: { code: string; message: string },
  connectionId: string,
  forgeRepositoryId: number,
  verificationId: string,
  verifiedAt: number,
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
