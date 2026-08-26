import {
  CODEX_PRE_START_ATTEMPT_LIMIT,
  CODEX_PRE_START_RETRY_DELAYS,
  isTransientCodexPreStartFailure,
  recordCodexPreStartFailure,
} from "../codex/codex-execution-pre-start.ts";

export const WAIVER_PRE_START_RETRY_DELAYS = CODEX_PRE_START_RETRY_DELAYS;
export const WAIVER_PRE_START_ATTEMPT_LIMIT = CODEX_PRE_START_ATTEMPT_LIMIT;

export function isTransientWaiverPreStartFailure(
  failure: Error & { code: string },
) {
  return isTransientCodexPreStartFailure(failure);
}

export function recordWaiverPreStartFailure(
  durableCore: any,
  claim: any,
  failure: unknown,
  now: () => number,
) {
  return recordCodexPreStartFailure(durableCore, claim, failure, now);
}
