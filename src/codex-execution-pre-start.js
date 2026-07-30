import { DurableCoreError } from "./durable-error.js";

export const CODEX_PRE_START_RETRY_DELAYS = Object.freeze([60_000, 300_000]);
export const CODEX_PRE_START_ATTEMPT_LIMIT = 3;

/** @param {Error & {code: string}} failure */
export function isTransientCodexPreStartFailure(failure) {
  return (
    failure.code === "review_run_checkout_failed" ||
    failure.code === "codex_pre_start_interrupted"
  );
}

const OWNERS = {
  review_run: {
    attemptOwnerColumn: "review_run_id",
    attemptTable: "review_run_pre_start_attempts",
    claimLostCode: "review_run_claim_lost",
    claimLostMessage: "Review Run claim is no longer authoritative",
    ownerTable: "review_runs",
  },
  waiver_adjudication: {
    attemptOwnerColumn: "waiver_adjudication_id",
    attemptTable: "waiver_adjudication_pre_start_attempts",
    claimLostCode: "waiver_adjudication_claim_lost",
    claimLostMessage: "Waiver Adjudication claim is no longer authoritative",
    ownerTable: "waiver_adjudications",
  },
};

/** @param {unknown} failure */
function requireFailure(failure) {
  if (
    !(failure instanceof Error) ||
    !("code" in failure) ||
    typeof failure.code !== "string" ||
    !/^[a-z][a-z0-9_]*$/.test(failure.code) ||
    failure.message.trim().length === 0
  ) {
    throw new TypeError("Codex execution pre-start failure is invalid");
  }
  return /** @type {Error & {code: string}} */ (failure);
}

/** @param {any} transaction @param {any} claim @param {number} at @param {boolean} requireActiveLease */
function readAttemptState(transaction, claim, at, requireActiveLease) {
  const owner = OWNERS[/** @type {keyof typeof OWNERS} */ (claim.workKind)];
  const state = transaction.get(
    `SELECT owner.retry_cycle, codex_execution_queue.ready_at
     FROM ${owner.ownerTable} AS owner
     JOIN codex_execution_queue
       ON codex_execution_queue.work_id = owner.id
      AND codex_execution_queue.work_kind = ?
     WHERE owner.id = ?
       AND owner.execution_status = 'queued'
       AND owner.started_at IS NULL
       AND codex_execution_queue.started_at IS NULL
       AND codex_execution_queue.retry_state = 'ready'
       AND codex_execution_queue.worker_id = ?
       AND codex_execution_queue.fencing_token = ?
       ${requireActiveLease ? "AND codex_execution_queue.lease_expires_at > ?" : ""}`,
    claim.workKind,
    claim.workId,
    claim.workerId,
    claim.fencingToken,
    ...(requireActiveLease ? [at] : []),
  );
  if (!state) {
    throw new DurableCoreError(owner.claimLostCode, owner.claimLostMessage);
  }
  const consumed = transaction.get(
    `SELECT count(*) AS count
     FROM ${owner.attemptTable}
     WHERE ${owner.attemptOwnerColumn} = ? AND retry_cycle = ?`,
    claim.workId,
    state.retry_cycle,
  )?.count;
  if (!Number.isSafeInteger(consumed) || consumed < 0) {
    throw new TypeError("Codex execution attempt history is invalid");
  }
  return { ...state, attemptNumber: consumed + 1, owner };
}

/** @param {any} durableCore @param {any} claim @param {() => number} now */
export function beginCodexPreStartAttempt(durableCore, claim, now) {
  const workKind = claim?.workKind;
  if (workKind !== "review_run" && workKind !== "waiver_adjudication") {
    throw new TypeError("Codex execution pre-start kind is invalid");
  }
  const startedAt = now();
  if (!Number.isSafeInteger(startedAt) || startedAt < 0) {
    throw new TypeError("Codex execution pre-start attempt time is invalid");
  }
  return durableCore.transaction((/** @type {any} */ transaction) => {
    const state = readAttemptState(transaction, claim, startedAt, true);
    transaction.run(
      `INSERT INTO codex_execution_pre_start_attempts (
         work_id, work_kind, retry_cycle, attempt_number,
         worker_id, fencing_token, started_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      claim.workId,
      workKind,
      state.retry_cycle,
      state.attemptNumber,
      claim.workerId,
      claim.fencingToken,
      startedAt,
    );
    return {
      attemptNumber: state.attemptNumber,
      retryCycle: state.retry_cycle,
      startedAt,
    };
  });
}

/**
 * @param {any} transaction
 * @param {any} claim
 * @param {Error & {code: string}} owningFailure
 * @param {number} failedAt
 * @param {boolean} requireActiveLease
 */
function appendFailure(
  transaction,
  claim,
  owningFailure,
  failedAt,
  requireActiveLease,
) {
  const state = readAttemptState(
    transaction,
    claim,
    failedAt,
    requireActiveLease,
  );
  let started = transaction.get(
    `SELECT started_at
     FROM codex_execution_pre_start_attempts
     WHERE work_id = ? AND work_kind = ? AND retry_cycle = ?
       AND attempt_number = ? AND worker_id = ? AND fencing_token = ?`,
    claim.workId,
    claim.workKind,
    state.retry_cycle,
    state.attemptNumber,
    claim.workerId,
    claim.fencingToken,
  );
  if (!started) {
    transaction.run(
      `INSERT INTO codex_execution_pre_start_attempts (
         work_id, work_kind, retry_cycle, attempt_number,
         worker_id, fencing_token, started_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      claim.workId,
      claim.workKind,
      state.retry_cycle,
      state.attemptNumber,
      claim.workerId,
      claim.fencingToken,
      failedAt,
    );
    started = { started_at: failedAt };
  }
  if (
    !started ||
    !Number.isSafeInteger(started.started_at) ||
    started.started_at > failedAt
  ) {
    throw new DurableCoreError(
      state.owner.claimLostCode,
      state.owner.claimLostMessage,
    );
  }
  const transient = isTransientCodexPreStartFailure(owningFailure);
  const exhausted =
    !transient || state.attemptNumber >= CODEX_PRE_START_ATTEMPT_LIMIT;
  const delay = exhausted
    ? 0
    : CODEX_PRE_START_RETRY_DELAYS[state.attemptNumber - 1];
  if (!exhausted && !Number.isSafeInteger(delay)) {
    throw new TypeError("Codex execution retry policy is invalid");
  }
  transaction.run(
    `INSERT INTO ${state.owner.attemptTable} (
       ${state.owner.attemptOwnerColumn}, retry_cycle, attempt_number,
       failed_at, error_code, error_detail, exhausted
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    claim.workId,
    state.retry_cycle,
    state.attemptNumber,
    failedAt,
    owningFailure.code,
    owningFailure.message,
    exhausted ? 1 : 0,
  );
  if (
    transaction.run(
      `UPDATE codex_execution_queue
       SET lease_expires_at = ?, ready_at = ?
       WHERE work_id = ? AND work_kind = ?
         AND worker_id = ? AND fencing_token = ?
         AND started_at IS NULL
         ${requireActiveLease ? "AND lease_expires_at > ?" : ""}`,
      failedAt,
      exhausted ? state.ready_at : failedAt + delay,
      claim.workId,
      claim.workKind,
      claim.workerId,
      claim.fencingToken,
      ...(requireActiveLease ? [failedAt] : []),
    ).changes !== 1
  ) {
    throw new DurableCoreError(
      state.owner.claimLostCode,
      state.owner.claimLostMessage,
    );
  }
  return {
    attemptNumber: state.attemptNumber,
    exhausted,
    nextAttemptAt: exhausted ? null : failedAt + delay,
    retryCycle: state.retry_cycle,
  };
}

/** @param {any} durableCore @param {any} claim @param {unknown} failure @param {() => number} now */
export function recordCodexPreStartFailure(durableCore, claim, failure, now) {
  const workKind = claim?.workKind;
  if (workKind !== "review_run" && workKind !== "waiver_adjudication") {
    throw new TypeError("Codex execution pre-start kind is invalid");
  }
  const owningFailure = requireFailure(failure);
  const failedAt = now();
  if (!Number.isSafeInteger(failedAt) || failedAt < 0) {
    throw new TypeError("Codex execution pre-start failure time is invalid");
  }
  return durableCore.transaction((/** @type {any} */ transaction) =>
    appendFailure(transaction, claim, owningFailure, failedAt, true),
  );
}

/** @param {any} transaction @param {any} work @param {number} recoveredAt */
export function recoverInterruptedCodexPreStartAttempt(
  transaction,
  work,
  recoveredAt,
) {
  const marker = transaction.get(
    `SELECT worker_id, fencing_token
     FROM codex_execution_pre_start_attempts
     WHERE work_id = ? AND work_kind = ?
       AND retry_cycle = (
         CASE ?
           WHEN 'review_run' THEN
             (SELECT retry_cycle FROM review_runs WHERE id = ?)
           ELSE
             (SELECT retry_cycle FROM waiver_adjudications WHERE id = ?)
         END
       )
       AND attempt_number = (
         CASE ?
           WHEN 'review_run' THEN
             (SELECT count(*) + 1 FROM review_run_pre_start_attempts
              WHERE review_run_id = ? AND retry_cycle =
                (SELECT retry_cycle FROM review_runs WHERE id = ?))
           ELSE
             (SELECT count(*) + 1 FROM waiver_adjudication_pre_start_attempts
              WHERE waiver_adjudication_id = ? AND retry_cycle =
                (SELECT retry_cycle FROM waiver_adjudications WHERE id = ?))
         END
       )`,
    work.work_id,
    work.work_kind,
    work.work_kind,
    work.work_id,
    work.work_id,
    work.work_kind,
    work.work_id,
    work.work_id,
    work.work_id,
    work.work_id,
  );
  if (!marker) {
    return false;
  }
  appendFailure(
    transaction,
    {
      fencingToken: marker.fencing_token,
      workerId: marker.worker_id,
      workId: work.work_id,
      workKind: work.work_kind,
    },
    Object.assign(
      new Error(
        work.work_kind === "review_run"
          ? "Review Run pre-start attempt was interrupted by application restart"
          : "Waiver Adjudication pre-start attempt was interrupted by application restart",
      ),
      { code: "codex_pre_start_interrupted" },
    ),
    recoveredAt,
    false,
  );
  return true;
}
