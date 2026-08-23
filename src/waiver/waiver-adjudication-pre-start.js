import {
  CODEX_PRE_START_ATTEMPT_LIMIT,
  CODEX_PRE_START_RETRY_DELAYS,
  isTransientCodexPreStartFailure,
  recordCodexPreStartFailure,
} from "../codex/codex-execution-pre-start.js";

export const WAIVER_PRE_START_RETRY_DELAYS = CODEX_PRE_START_RETRY_DELAYS;
export const WAIVER_PRE_START_ATTEMPT_LIMIT = CODEX_PRE_START_ATTEMPT_LIMIT;

/** @param {Error & {code: string}} failure */
export function isTransientWaiverPreStartFailure(failure) {
  return isTransientCodexPreStartFailure(failure);
}

/** @param {any} durableCore @param {any} claim @param {unknown} failure @param {() => number} now */
export function recordWaiverPreStartFailure(durableCore, claim, failure, now) {
  return recordCodexPreStartFailure(durableCore, claim, failure, now);
}
