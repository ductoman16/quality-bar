import {
  isDefinitiveForgejoPollingFailure,
  isRepositoryOwnedDefinitiveForgejoPollingFailure,
} from "./forgejo-polling-failure.ts";

export function gatesForgejoConnection(
  failure: Error & {
    code: string;
    nextAttemptAt?: number;
    repositoryId?: number;
  },
) {
  return (
    (isDefinitiveForgejoPollingFailure(failure) &&
      !isRepositoryOwnedDefinitiveForgejoPollingFailure(failure)) ||
    Number.isSafeInteger(failure.nextAttemptAt)
  );
}
