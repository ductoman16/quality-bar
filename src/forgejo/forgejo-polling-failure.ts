export const FORGEJO_POLL_INTERVAL_MS = 60_000;

import { forgejoDefinitiveFailureScope } from "./forgejo-failure.ts";

const POLLING_REPOSITORY_FAILURES = new Set([
  "evaluation_git_acquisition_failed",
  "evaluation_git_acquisition_unavailable",
  "evaluation_selector_not_found",
  "forgejo_pull_request_merge_base_inaccessible",
  "forgejo_pull_request_head_inaccessible",
  "repository_git_credentials_unavailable",
]);

export function isDefinitiveForgejoPollingFailure(failure: { code?: string }) {
  return forgejoDefinitiveFailureScope(failure) !== null;
}

export function isRepositoryOwnedDefinitiveForgejoPollingFailure(failure: {
  code?: string;
  repositoryId?: number;
}) {
  return forgejoDefinitiveFailureScope(failure) === "repository";
}

export function isRepositoryOwnedForgejoPollingFailure(failure: {
  code?: string;
  repositoryId?: number;
}) {
  return (
    forgejoDefinitiveFailureScope(failure) === "repository" ||
    (Number.isSafeInteger(failure.repositoryId) &&
      typeof failure.code === "string" &&
      POLLING_REPOSITORY_FAILURES.has(failure.code))
  );
}

export function nextForgejoAttemptAt(
  attemptedAt: number,
  failure: { code?: string; nextAttemptAt?: number },
) {
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
