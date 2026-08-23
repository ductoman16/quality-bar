import { GitHubConnectionError } from "./github-connection-error.js";

const DEFINITIVE_FAILURES = new Set([
  "github_api_request_failed",
  "github_app_profile_mismatch",
  "github_connection_credential_invalid",
  "github_connection_credential_undecryptable",
  "github_installation_scope_invalid",
  "github_permissions_mismatch",
  "github_principal_mismatch",
  "github_repository_api_access_failed",
  "repository_authentication_failed",
  "repository_permission_denied",
]);

/** @param {{code?: string}} failure */
export function isDefinitiveGitHubPollingFailure(failure) {
  return (
    typeof failure.code === "string" && DEFINITIVE_FAILURES.has(failure.code)
  );
}

/** @param {number} attemptedAt @param {{code?: string, nextAttemptAt?: number}} failure */
export function nextGitHubAttemptAt(attemptedAt, failure) {
  if (!Number.isSafeInteger(attemptedAt) || attemptedAt < 0) {
    throw new TypeError("GitHub polling attempt time is invalid");
  }
  if (isDefinitiveGitHubPollingFailure(failure)) {
    return null;
  }
  return failure.nextAttemptAt && failure.nextAttemptAt > attemptedAt
    ? failure.nextAttemptAt
    : attemptedAt + 60_000;
}

/** @param {unknown} error */
export function githubPollingFailure(error) {
  if (error instanceof GitHubConnectionError) {
    return error;
  }
  if (error instanceof Error) {
    throw error;
  }
  throw new TypeError("GitHub polling failed with a non-Error value");
}
