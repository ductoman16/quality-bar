import { DurableCoreError } from "./durable-error.js";

export const WAIVER_PRE_START_RETRY_DELAYS = Object.freeze([60_000, 300_000]);
export const WAIVER_PRE_START_ATTEMPT_LIMIT = 3;

/** @param {unknown} failure */
function requireFailure(failure) {
  if (
    !(failure instanceof Error) ||
    !("code" in failure) ||
    typeof failure.code !== "string" ||
    !/^[a-z][a-z0-9_]*$/.test(failure.code) ||
    failure.message.trim().length === 0
  ) {
    throw new TypeError("Waiver Adjudication pre-start failure is invalid");
  }
  return /** @type {Error & {code: string}} */ (failure);
}

/** @param {Error & {code: string}} failure */
export function isTransientWaiverPreStartFailure(failure) {
  return failure.code === "review_run_checkout_failed";
}

/** @param {any} durableCore @param {any} claim @param {unknown} failure @param {() => number} now */
export function recordWaiverPreStartFailure(durableCore, claim, failure, now) {
  const owningFailure = requireFailure(failure);
  const failedAt = now();
  if (!Number.isSafeInteger(failedAt) || failedAt < 0) {
    throw new TypeError(
      "Waiver Adjudication pre-start failure time is invalid",
    );
  }
  return durableCore.transaction((/** @type {any} */ transaction) => {
    const state = transaction.get(
      `SELECT waiver_adjudications.retry_cycle,
              codex_execution_queue.ready_at
       FROM waiver_adjudications
       JOIN codex_execution_queue
         ON codex_execution_queue.work_id = waiver_adjudications.id
        AND codex_execution_queue.work_kind = 'waiver_adjudication'
       WHERE waiver_adjudications.id = ?
         AND waiver_adjudications.execution_status = 'queued'
         AND waiver_adjudications.started_at IS NULL
         AND codex_execution_queue.started_at IS NULL
         AND codex_execution_queue.retry_state = 'ready'
         AND codex_execution_queue.worker_id = ?
         AND codex_execution_queue.fencing_token = ?
         AND codex_execution_queue.lease_expires_at > ?`,
      claim.workId,
      claim.workerId,
      claim.fencingToken,
      failedAt,
    );
    if (!state) {
      throw new DurableCoreError(
        "waiver_adjudication_claim_lost",
        "Waiver Adjudication claim is no longer authoritative",
      );
    }
    const consumed = transaction.get(
      `SELECT count(*) AS count
       FROM waiver_adjudication_pre_start_attempts
       WHERE waiver_adjudication_id = ? AND retry_cycle = ?`,
      claim.workId,
      state.retry_cycle,
    )?.count;
    if (!Number.isSafeInteger(consumed) || consumed < 0) {
      throw new TypeError("Waiver Adjudication attempt history is invalid");
    }
    const attemptNumber = consumed + 1;
    const transient = isTransientWaiverPreStartFailure(owningFailure);
    const exhausted =
      !transient || attemptNumber >= WAIVER_PRE_START_ATTEMPT_LIMIT;
    const delay = exhausted
      ? 0
      : WAIVER_PRE_START_RETRY_DELAYS[attemptNumber - 1];
    if (!exhausted && !Number.isSafeInteger(delay)) {
      throw new TypeError("Waiver Adjudication retry policy is invalid");
    }
    transaction.run(
      `INSERT INTO waiver_adjudication_pre_start_attempts (
         waiver_adjudication_id, retry_cycle, attempt_number,
         failed_at, error_code, error_detail, exhausted
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      claim.workId,
      state.retry_cycle,
      attemptNumber,
      failedAt,
      owningFailure.code,
      owningFailure.message,
      exhausted ? 1 : 0,
    );
    if (
      transaction.run(
        `UPDATE codex_execution_queue
         SET lease_expires_at = ?, ready_at = ?
         WHERE work_id = ? AND work_kind = 'waiver_adjudication'
           AND worker_id = ? AND fencing_token = ?
           AND started_at IS NULL AND lease_expires_at > ?`,
        failedAt,
        exhausted ? state.ready_at : failedAt + delay,
        claim.workId,
        claim.workerId,
        claim.fencingToken,
        failedAt,
      ).changes !== 1
    ) {
      throw new DurableCoreError(
        "waiver_adjudication_claim_lost",
        "Waiver Adjudication claim is no longer authoritative",
      );
    }
    return {
      attemptNumber,
      exhausted,
      nextAttemptAt: exhausted ? null : failedAt + delay,
      retryCycle: state.retry_cycle,
    };
  });
}
