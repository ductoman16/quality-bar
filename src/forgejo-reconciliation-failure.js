import {
  isDefinitiveForgejoPollingFailure,
  isRepositoryOwnedDefinitiveForgejoPollingFailure,
} from "./forgejo-polling-failure.js";

/** @param {Error & {code: string, nextAttemptAt?: number, repositoryId?: number}} failure */
export function gatesForgejoConnection(failure) {
  return (
    (isDefinitiveForgejoPollingFailure(failure) &&
      !isRepositoryOwnedDefinitiveForgejoPollingFailure(failure)) ||
    Number.isSafeInteger(failure.nextAttemptAt)
  );
}
