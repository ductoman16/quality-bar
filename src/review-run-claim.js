import { DurableCoreError } from "./durable-error.js";

export const REVIEW_RUN_RENEWAL_MILLISECONDS = 30_000;
export const REVIEW_RUN_LEASE_MILLISECONDS = 120_000;

/**
 * @typedef {{
 *   fencingToken: number,
 *   leaseExpiresAt: number,
 *   workerId: string,
 *   workId: string
 * }} ReviewRunClaim
 */

/**
 * @typedef {{
 *   get(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): Record<string, import("node:sqlite").SQLInputValue> | undefined,
 *   run(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): import("node:sqlite").StatementResultingChanges
 * }} ReviewRunClaimTransaction
 */

/**
 * @param {unknown} workerId
 * @returns {asserts workerId is string}
 */
function assertWorkerId(workerId) {
  if (typeof workerId !== "string" || workerId.length === 0) {
    throw new TypeError("Review Run worker identity is invalid");
  }
}

/**
 * @param {unknown} timestamp
 * @returns {asserts timestamp is number}
 */
function assertTimestamp(timestamp) {
  if (
    typeof timestamp !== "number" ||
    !Number.isSafeInteger(timestamp) ||
    timestamp < 0
  ) {
    throw new TypeError("Review Run claim time is invalid");
  }
}

/**
 * @param {ReviewRunClaim} claim
 */
function assertClaim(claim) {
  if (
    !claim ||
    typeof claim.workId !== "string" ||
    claim.workId.length === 0 ||
    typeof claim.workerId !== "string" ||
    claim.workerId.length === 0 ||
    !Number.isSafeInteger(claim.fencingToken) ||
    claim.fencingToken <= 0
  ) {
    throw new TypeError("Review Run claim is invalid");
  }
}

/**
 * @param {{
 *   transaction: <Result>(
 *     callback: (transaction: ReviewRunClaimTransaction) => Result
 *   ) => Result
 * }} durableCore
 * @param {{
 *   clearInterval?: (timer: unknown) => void,
 *   createWorkerId: () => string,
 *   now: () => number,
 *   setInterval?: (callback: () => void, milliseconds: number) => unknown
 * }} options
 */
export function createReviewRunClaimService(
  durableCore,
  {
    clearInterval: cancelInterval = (timer) =>
      clearInterval(/** @type {NodeJS.Timeout} */ (timer)),
    createWorkerId,
    now,
    setInterval: scheduleInterval = (callback, milliseconds) =>
      setInterval(callback, milliseconds),
  },
) {
  /**
   * @returns {never}
   */
  function claimLost() {
    throw new DurableCoreError(
      "review_run_claim_lost",
      "Review Run claim is no longer authoritative",
    );
  }

  const service = {
    /**
     * @returns {ReviewRunClaim | undefined}
     */
    claimNext() {
      const claimedAt = now();
      assertTimestamp(claimedAt);
      const workerId = createWorkerId();
      assertWorkerId(workerId);
      const leaseExpiresAt = claimedAt + REVIEW_RUN_LEASE_MILLISECONDS;
      assertTimestamp(leaseExpiresAt);
      return durableCore.transaction((transaction) => {
        const queued = transaction.get(
          `SELECT work_id, fencing_token
           FROM codex_execution_queue
           WHERE started_at IS NULL
             AND ready_at <= ?
             AND (worker_id IS NULL OR lease_expires_at <= ?)
           ORDER BY ready_at, work_id
           LIMIT 1`,
          claimedAt,
          claimedAt,
        );
        if (!queued) {
          return undefined;
        }
        const workId = /** @type {string} */ (queued.work_id);
        const fencingToken = /** @type {number} */ (queued.fencing_token) + 1;
        const updated = transaction.run(
          `UPDATE codex_execution_queue
           SET worker_id = ?, fencing_token = ?, lease_expires_at = ?
           WHERE work_id = ?
             AND fencing_token = ?
             AND started_at IS NULL
             AND (worker_id IS NULL OR lease_expires_at <= ?)`,
          workerId,
          fencingToken,
          leaseExpiresAt,
          workId,
          queued.fencing_token,
          claimedAt,
        );
        if (updated.changes !== 1) {
          claimLost();
        }
        return { fencingToken, leaseExpiresAt, workerId, workId };
      });
    },
    /**
     * @param {ReviewRunClaim} claim
     * @returns {ReviewRunClaim}
     */
    renew(claim) {
      assertClaim(claim);
      const renewedAt = now();
      assertTimestamp(renewedAt);
      const leaseExpiresAt = renewedAt + REVIEW_RUN_LEASE_MILLISECONDS;
      assertTimestamp(leaseExpiresAt);
      return durableCore.transaction((transaction) => {
        const updated = transaction.run(
          `UPDATE codex_execution_queue
           SET lease_expires_at = ?
           WHERE work_id = ?
             AND worker_id = ?
             AND fencing_token = ?
             AND lease_expires_at > ?`,
          leaseExpiresAt,
          claim.workId,
          claim.workerId,
          claim.fencingToken,
          renewedAt,
        );
        if (updated.changes !== 1) {
          claimLost();
        }
        return { ...claim, leaseExpiresAt };
      });
    },
    /**
     * @param {ReviewRunClaim} claim
     */
    start(claim) {
      assertClaim(claim);
      const startedAt = now();
      assertTimestamp(startedAt);
      return durableCore.transaction((transaction) => {
        const startedQueue = transaction.run(
          `UPDATE codex_execution_queue
           SET started_at = ?
           WHERE work_id = ?
             AND worker_id = ?
             AND fencing_token = ?
             AND started_at IS NULL
             AND lease_expires_at > ?`,
          startedAt,
          claim.workId,
          claim.workerId,
          claim.fencingToken,
          startedAt,
        );
        if (startedQueue.changes !== 1) {
          claimLost();
        }
        const startedReviewRun = transaction.run(
          `UPDATE review_runs
           SET execution_status = 'running', started_at = ?
           WHERE id = ? AND execution_status = 'queued'`,
          startedAt,
          claim.workId,
        );
        if (startedReviewRun.changes !== 1) {
          throw new DurableCoreError(
            "review_run_state_invalid",
            "Review Run is not queued for launch",
          );
        }
      });
    },
    /**
     * @param {ReviewRunClaim} claim
     * @param {(error: unknown) => void} onClaimLost
     * @returns {() => void}
     */
    startRenewal(claim, onClaimLost) {
      assertClaim(claim);
      let active = true;
      let currentClaim = claim;
      const timer = scheduleInterval(() => {
        if (!active) {
          return;
        }
        try {
          currentClaim = service.renew(currentClaim);
        } catch (error) {
          active = false;
          cancelInterval(timer);
          onClaimLost(error);
        }
      }, REVIEW_RUN_RENEWAL_MILLISECONDS);
      return () => {
        if (active) {
          active = false;
          cancelInterval(timer);
        }
      };
    },
  };
  return service;
}
