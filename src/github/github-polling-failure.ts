import { GitHubConnectionError } from "./github-connection-error.ts";

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

export function isDefinitiveGitHubPollingFailure(failure: { code?: string }) {
  return (
    typeof failure.code === "string" && DEFINITIVE_FAILURES.has(failure.code)
  );
}

export function nextGitHubAttemptAt(
  attemptedAt: number,
  failure: { code?: string; nextAttemptAt?: number },
) {
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

export function githubPollingFailure(error: unknown) {
  if (error instanceof GitHubConnectionError) {
    return error;
  }
  if (error instanceof Error) {
    throw error;
  }
  throw new TypeError("GitHub polling failed with a non-Error value");
}
