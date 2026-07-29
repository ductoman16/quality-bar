const REPOSITORY_SCOPED_VERIFICATION_ERRORS = new Set([
  "forgejo_poll_response_invalid",
  "forgejo_repository_api_access_failed",
  "forgejo_repository_capability_missing",
  "forgejo_repository_permission_denied",
  "forgejo_repository_selection_unavailable",
  "repository_git_read_failed",
  "repository_git_verification_unavailable",
]);

/** @param {string} code @param {number | undefined} repositoryId */
export function forgejoVerificationErrorScope(code, repositoryId) {
  return REPOSITORY_SCOPED_VERIFICATION_ERRORS.has(code) &&
    (repositoryId === undefined || Number.isSafeInteger(repositoryId))
    ? "repository"
    : "connection";
}
