export const FORGEJO_POLL_INTERVAL_MS = 60_000;

import { forgejoDefinitiveFailureScope } from "./forgejo-failure.js";

const POLLING_REPOSITORY_FAILURES = new Set([
  "evaluation_git_acquisition_failed",
  "evaluation_git_acquisition_unavailable",
  "evaluation_selector_not_found",
  "forgejo_pull_request_merge_base_inaccessible",
  "forgejo_pull_request_head_inaccessible",
  "repository_git_credentials_unavailable",
]);

/** @param {{code?: string}} failure */
export function isDefinitiveForgejoPollingFailure(failure) {
  return forgejoDefinitiveFailureScope(failure) !== null;
}

/** @param {{code?: string, repositoryId?: number}} failure */
export function isRepositoryOwnedDefinitiveForgejoPollingFailure(failure) {
  return forgejoDefinitiveFailureScope(failure) === "repository";
}

/** @param {{code?: string, repositoryId?: number}} failure */
export function isRepositoryOwnedForgejoPollingFailure(failure) {
  return (
    forgejoDefinitiveFailureScope(failure) === "repository" ||
    (Number.isSafeInteger(failure.repositoryId) &&
      typeof failure.code === "string" &&
      POLLING_REPOSITORY_FAILURES.has(failure.code))
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
