const CONNECTION_FAILURES = new Set([
  "forgejo_api_response_invalid",
  "forgejo_connection_credential_invalid",
  "forgejo_connection_credential_undecryptable",
  "forgejo_credential_undecryptable",
  "forgejo_openapi_invalid",
  "forgejo_poll_response_invalid",
  "forgejo_principal_invalid",
  "forgejo_publication_capability_unavailable",
  "forgejo_reactivation_identity_mismatch",
  "forgejo_repository_enumeration_incomplete",
  "forgejo_required_route_invalid",
  "forgejo_required_route_unavailable",
  "forgejo_rotation_identity_mismatch",
  "forgejo_verification_result_invalid",
  "forgejo_version_unsupported",
  "repository_authentication_failed",
]);

const REPOSITORY_FAILURES = new Set([
  "forgejo_repository_api_access_failed",
  "forgejo_repository_capability_missing",
  "forgejo_repository_permission_denied",
  "forgejo_repository_selection_unavailable",
  "repository_git_read_failed",
  "repository_permission_denied",
]);

/** @param {{code?: string}} failure */
export function isForgejoRepositoryFailure(failure) {
  return (
    typeof failure.code === "string" && REPOSITORY_FAILURES.has(failure.code)
  );
}

/** @param {{repositoryId?: number, repositoryIds?: number[]}} failure */
export function forgejoFailureRepositoryIds(failure) {
  const hasRepositoryId = failure.repositoryId !== undefined;
  const hasRepositoryIds = failure.repositoryIds !== undefined;
  const repositoryIds = hasRepositoryIds
    ? failure.repositoryIds
    : hasRepositoryId
      ? [failure.repositoryId]
      : [];
  if (
    !Array.isArray(repositoryIds) ||
    repositoryIds.some(
      (repositoryId) =>
        !Number.isSafeInteger(repositoryId) || Number(repositoryId) <= 0,
    ) ||
    (hasRepositoryId &&
      hasRepositoryIds &&
      (repositoryIds.length !== 1 ||
        repositoryIds[0] !== failure.repositoryId)) ||
    new Set(repositoryIds).size !== repositoryIds.length
  ) {
    throw new TypeError("Forgejo failure Repository owners are invalid");
  }
  return /** @type {number[]} */ (repositoryIds);
}

/**
 * @param {{code?: string, repositoryId?: number, repositoryIds?: number[], responseStatus?: number}} failure
 * @returns {"connection" | "repository" | null}
 */
export function forgejoDefinitiveFailureScope(failure) {
  if (
    failure.responseStatus === 401 ||
    (typeof failure.code === "string" && CONNECTION_FAILURES.has(failure.code))
  ) {
    return "connection";
  }
  if (
    forgejoFailureRepositoryIds(failure).length > 0 &&
    isForgejoRepositoryFailure(failure)
  ) {
    return "repository";
  }
  return null;
}
