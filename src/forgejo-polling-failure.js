export const FORGEJO_POLL_INTERVAL_MS = 60_000;

const DEFINITIVE_FAILURES = new Set([
  "forgejo_connection_credential_invalid",
  "forgejo_connection_credential_undecryptable",
  "forgejo_credential_undecryptable",
  "forgejo_poll_response_invalid",
  "forgejo_repository_api_access_failed",
  "forgejo_repository_permission_denied",
  "repository_authentication_failed",
  "repository_git_read_failed",
  "repository_permission_denied",
  "forgejo_version_unsupported",
]);
const REPOSITORY_OWNED_DEFINITIVE_FAILURES = new Set([
  "forgejo_poll_response_invalid",
  "forgejo_repository_api_access_failed",
  "forgejo_repository_permission_denied",
  "repository_permission_denied",
  "repository_git_read_failed",
]);
const REPOSITORY_OWNED_FAILURES = new Set([
  ...REPOSITORY_OWNED_DEFINITIVE_FAILURES,
  "evaluation_git_acquisition_failed",
  "evaluation_git_acquisition_unavailable",
  "evaluation_selector_not_found",
  "forgejo_pull_request_merge_base_inaccessible",
  "forgejo_pull_request_head_inaccessible",
  "repository_git_credentials_unavailable",
  "repository_git_read_failed",
]);

/** @param {{code?: string}} failure */
export function isDefinitiveForgejoPollingFailure(failure) {
  return (
    typeof failure.code === "string" && DEFINITIVE_FAILURES.has(failure.code)
  );
}

/** @param {{code?: string, repositoryId?: number}} failure */
export function isRepositoryOwnedDefinitiveForgejoPollingFailure(failure) {
  return (
    Number.isSafeInteger(failure.repositoryId) &&
    typeof failure.code === "string" &&
    REPOSITORY_OWNED_DEFINITIVE_FAILURES.has(failure.code)
  );
}

/** @param {{code?: string, repositoryId?: number}} failure */
export function isRepositoryOwnedForgejoPollingFailure(failure) {
  return (
    Number.isSafeInteger(failure.repositoryId) &&
    typeof failure.code === "string" &&
    REPOSITORY_OWNED_FAILURES.has(failure.code)
  );
}

/** @param {number} attemptedAt @param {{code?: string, nextAttemptAt?: number}} failure */
export function nextForgejoAttemptAt(attemptedAt, failure) {
  if (!Number.isSafeInteger(attemptedAt) || attemptedAt < 0) {
    throw new TypeError("Forgejo polling attempt time is invalid");
  }
  if (isDefinitiveForgejoPollingFailure(failure)) {
    return null;
  }
  const providerAttemptAt = failure.nextAttemptAt;
  return Number.isSafeInteger(providerAttemptAt) &&
    Number(providerAttemptAt) >= attemptedAt
    ? Number(providerAttemptAt)
    : attemptedAt + FORGEJO_POLL_INTERVAL_MS;
}
