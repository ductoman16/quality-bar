import { DurableCoreError } from "./durable-error.js";
import { readCodexExecutionConcurrency } from "./codex-execution-concurrency.js";
import { recordWaiverPreStartFailure } from "./waiver-adjudication-pre-start.js";

export const CODEX_EXECUTION_RENEWAL_MILLISECONDS = 30_000;
export const CODEX_EXECUTION_LEASE_MILLISECONDS = 120_000;

const WORK_OWNERS = {
  review_run: {
    claimLostCode: "review_run_claim_lost",
    claimLostMessage: "Review Run claim is no longer authoritative",
    stateCode: "review_run_state_invalid",
    stateMessage: "Review Run is not queued for launch",
    table: "review_runs",
    versionMessage: "Review Run Codex CLI version is invalid",
  },
  waiver_adjudication: {
    claimLostCode: "waiver_adjudication_claim_lost",
    claimLostMessage: "Waiver Adjudication claim is no longer authoritative",
    stateCode: "waiver_adjudication_state_invalid",
    stateMessage: "Waiver Adjudication is not queued for launch",
    table: "waiver_adjudications",
    versionMessage: "Waiver Adjudication Codex CLI version is invalid",
  },
};

/**
 * @typedef {"review_run" | "waiver_adjudication"} CodexExecutionKind
 * @typedef {{
 *   fencingToken: number,
 *   leaseExpiresAt: number,
 *   workerId: string,
 *   workId: string,
 *   workKind: CodexExecutionKind
 * }} CodexExecutionClaim
 */

/** @param {unknown} value @param {string} message */
function requireNonblank(value, message) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(message);
  }
}

/** @param {unknown} value */
function requireTimestamp(value) {
  if (!Number.isSafeInteger(value) || /** @type {number} */ (value) < 0) {
    throw new TypeError("Codex execution claim time is invalid");
  }
}

/** @param {unknown} value @returns {asserts value is CodexExecutionKind} */
function requireWorkKind(value) {
  if (value !== "review_run" && value !== "waiver_adjudication") {
    throw new DurableCoreError(
      "codex_execution_kind_invalid",
      "Queued Codex execution kind is invalid",
    );
  }
}

/** @param {CodexExecutionClaim} claim */
function assertClaim(claim) {
  requireNonblank(claim?.workId, "Codex execution claim is invalid");
  requireNonblank(
    claim?.workerId,
    "Codex execution worker identity is invalid",
  );
  requireWorkKind(claim?.workKind);
  if (!Number.isSafeInteger(claim.fencingToken) || claim.fencingToken < 1) {
    throw new TypeError("Codex execution claim is invalid");
  }
}

/** @param {any} transaction */
function countRunningCodexExecutions(transaction) {
  return transaction.get(
    `SELECT count(*) AS count
     FROM codex_execution_queue AS running_queue
     LEFT JOIN review_runs AS running_review_run
       ON running_queue.work_kind = 'review_run'
      AND running_review_run.id = running_queue.work_id
     LEFT JOIN waiver_adjudications AS running_adjudication
       ON running_queue.work_kind = 'waiver_adjudication'
      AND running_adjudication.id = running_queue.work_id
     WHERE running_queue.started_at IS NOT NULL
       AND (
         running_review_run.execution_status = 'running'
         OR running_adjudication.execution_status = 'running'
       )`,
  )?.count;
}

/**
 * @param {{
 *   transaction: (callback: (transaction: any) => any) => any
 * }} durableCore
 * @param {{
 *   clearInterval?: (timer: unknown) => void,
 *   createWorkerId: () => string,
 *   now: () => number,
 *   setInterval?: (callback: () => void, milliseconds: number) => unknown
 * }} options
 */
export function createCodexExecutionClaimService(
  durableCore,
  {
    clearInterval: cancelInterval = (timer) =>
      clearInterval(/** @type {NodeJS.Timeout} */ (timer)),
    createWorkerId,
    now,
    setInterval: scheduleInterval = setInterval,
  },
) {
  /** @param {CodexExecutionKind} workKind @returns {never} */
  function claimLost(workKind) {
    const owner = WORK_OWNERS[workKind];
    throw new DurableCoreError(owner.claimLostCode, owner.claimLostMessage);
  }

  const service = {
    /** @returns {CodexExecutionClaim | undefined} */
    claimNext() {
      const claimedAt = now();
      const workerId = createWorkerId();
      requireTimestamp(claimedAt);
      requireNonblank(workerId, "Codex execution worker identity is invalid");
      const leaseExpiresAt = claimedAt + CODEX_EXECUTION_LEASE_MILLISECONDS;
      requireTimestamp(leaseExpiresAt);
      return durableCore.transaction((transaction) => {
        const maximumRunning = readCodexExecutionConcurrency(transaction);
        const queued = transaction.get(
          `SELECT work_id, work_kind, fencing_token
           FROM codex_execution_queue
           WHERE started_at IS NULL
             AND retry_state = 'ready'
             AND ready_at <= ?
             AND (worker_id IS NULL OR lease_expires_at <= ?)
             AND (
               SELECT count(*)
               FROM codex_execution_queue AS active_queue
               LEFT JOIN review_runs AS active_review_run
                 ON active_queue.work_kind = 'review_run'
                AND active_review_run.id = active_queue.work_id
               LEFT JOIN waiver_adjudications AS active_adjudication
                 ON active_queue.work_kind = 'waiver_adjudication'
                AND active_adjudication.id = active_queue.work_id
               WHERE (
                 (active_queue.work_kind = 'review_run'
                   AND active_review_run.execution_status IN ('queued', 'running'))
                 OR
                 (active_queue.work_kind = 'waiver_adjudication'
                   AND active_adjudication.execution_status IN ('queued', 'running'))
               )
               AND (
                 active_queue.started_at IS NOT NULL
                 OR (
                   active_queue.worker_id IS NOT NULL
                   AND active_queue.lease_expires_at > ?
                 )
               )
             ) < ?
           ORDER BY ready_at, work_id
           LIMIT 1`,
          claimedAt,
          claimedAt,
          claimedAt,
          maximumRunning,
        );
        if (!queued) {
          return undefined;
        }
        requireWorkKind(queued.work_kind);
        const workKind = queued.work_kind;
        const fencingToken = queued.fencing_token + 1;
        const updated = transaction.run(
          `UPDATE codex_execution_queue
           SET worker_id = ?, fencing_token = ?, lease_expires_at = ?
           WHERE work_id = ? AND work_kind = ? AND fencing_token = ?
             AND started_at IS NULL
             AND retry_state = 'ready'
             AND (worker_id IS NULL OR lease_expires_at <= ?)`,
          workerId,
          fencingToken,
          leaseExpiresAt,
          queued.work_id,
          workKind,
          queued.fencing_token,
          claimedAt,
        );
        if (updated.changes !== 1) {
          claimLost(workKind);
        }
        return {
          fencingToken,
          leaseExpiresAt,
          workerId,
          workId: queued.work_id,
          workKind,
        };
      });
    },
    /** @param {CodexExecutionClaim} claim */
    renew(claim) {
      assertClaim(claim);
      const renewedAt = now();
      requireTimestamp(renewedAt);
      const leaseExpiresAt = renewedAt + CODEX_EXECUTION_LEASE_MILLISECONDS;
      requireTimestamp(leaseExpiresAt);
      return durableCore.transaction((transaction) => {
        const updated = transaction.run(
          `UPDATE codex_execution_queue
           SET lease_expires_at = ?
           WHERE work_id = ? AND work_kind = ?
             AND worker_id = ? AND fencing_token = ?
             AND retry_state = 'ready'
             AND lease_expires_at > ?`,
          leaseExpiresAt,
          claim.workId,
          claim.workKind,
          claim.workerId,
          claim.fencingToken,
          renewedAt,
        );
        if (updated.changes !== 1) {
          claimLost(claim.workKind);
        }
        return { ...claim, leaseExpiresAt };
      });
    },
    /** @param {CodexExecutionClaim} claim @param {unknown} failure */
    recordPreStartFailure(claim, failure) {
      assertClaim(claim);
      if (claim.workKind !== "waiver_adjudication") {
        throw new TypeError(
          "Only Waiver Adjudication claims own pre-start retry",
        );
      }
      return recordWaiverPreStartFailure(durableCore, claim, failure, now);
    },
    /** @param {CodexExecutionClaim} claim @param {string} codexCliVersion */
    start(claim, codexCliVersion) {
      assertClaim(claim);
      const owner = WORK_OWNERS[claim.workKind];
      requireNonblank(codexCliVersion, owner.versionMessage);
      const startedAt = now();
      requireTimestamp(startedAt);
      const started = durableCore.transaction((transaction) => {
        const maximumRunning = readCodexExecutionConcurrency(transaction);
        const running = countRunningCodexExecutions(transaction);
        if (!Number.isSafeInteger(running) || running < 0) {
          throw new DurableCoreError(
            "codex_execution_concurrency_unavailable",
            "Codex execution concurrency is unavailable",
          );
        }
        if (running >= maximumRunning) {
          const released = transaction.run(
            `UPDATE codex_execution_queue SET lease_expires_at = ?
             WHERE work_id = ? AND work_kind = ?
               AND worker_id = ? AND fencing_token = ?
               AND retry_state = 'ready'
               AND started_at IS NULL AND lease_expires_at > ?`,
            startedAt,
            claim.workId,
            claim.workKind,
            claim.workerId,
            claim.fencingToken,
            startedAt,
          );
          if (released.changes !== 1) {
            claimLost(claim.workKind);
          }
          return false;
        }
        const startedQueue = transaction.run(
          `UPDATE codex_execution_queue SET started_at = ?
           WHERE work_id = ? AND work_kind = ?
             AND worker_id = ? AND fencing_token = ?
             AND retry_state = 'ready'
             AND started_at IS NULL AND lease_expires_at > ?`,
          startedAt,
          claim.workId,
          claim.workKind,
          claim.workerId,
          claim.fencingToken,
          startedAt,
        );
        if (startedQueue.changes !== 1) {
          claimLost(claim.workKind);
        }
        const startedOwner = transaction.run(
          `UPDATE ${owner.table}
           SET execution_status = 'running', started_at = ?,
               codex_cli_version = ?
           WHERE id = ? AND execution_status = 'queued'`,
          startedAt,
          codexCliVersion,
          claim.workId,
        );
        if (startedOwner.changes !== 1) {
          throw new DurableCoreError(owner.stateCode, owner.stateMessage);
        }
        return true;
      });
      if (!started) {
        throw new DurableCoreError(
          "codex_execution_concurrency_unavailable",
          "Codex execution concurrency is unavailable",
        );
      }
    },
    /**
     * @param {CodexExecutionClaim} claim
     * @param {(error: unknown) => void} onClaimLost
     */
    startRenewal(claim, onClaimLost) {
      assertClaim(claim);
      let active = true;
      let current = claim;
      const timer = scheduleInterval(() => {
        if (!active) {
          return;
        }
        try {
          current = service.renew(current);
        } catch (error) {
          active = false;
          cancelInterval(timer);
          onClaimLost(error);
        }
      }, CODEX_EXECUTION_RENEWAL_MILLISECONDS);
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
