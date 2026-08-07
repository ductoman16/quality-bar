import { DurableCoreError } from "./durable-error.js";
import { readCodexExecutionConcurrency } from "./codex-execution-concurrency.js";
import {
  readCodexProcessIdentity,
  requireCodexProcessIdentity,
} from "./codex-process-identity.js";
import { startCodexExecution } from "./codex-execution-start.js";
import {
  beginCodexPreStartAttempt,
  recordCodexPreStartFailure,
  recoverInterruptedCodexPreStartAttempt,
} from "./codex-execution-pre-start.js";

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

/**
 * @param {{
 *   transaction: (callback: (transaction: any) => any) => any
 * }} durableCore
 * @param {{
 *   clearInterval?: (timer: unknown) => void,
 *   createWorkerId: () => string,
 *   now: () => number,
 *   readProcessIdentity?: typeof readCodexProcessIdentity,
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
    readProcessIdentity = readCodexProcessIdentity,
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
        const expiredAttempts = transaction.all(
          `SELECT DISTINCT queue.work_id, queue.work_kind
           FROM codex_execution_queue AS queue
           JOIN codex_execution_pre_start_attempts AS attempt
             ON attempt.work_id = queue.work_id
            AND attempt.work_kind = queue.work_kind
           WHERE queue.started_at IS NULL
             AND queue.retry_state = 'ready'
             AND queue.worker_id IS NOT NULL
             AND queue.lease_expires_at <= ?`,
          claimedAt,
        );
        for (const expired of expiredAttempts) {
          recoverInterruptedCodexPreStartAttempt(
            transaction,
            expired,
            claimedAt,
          );
        }
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
      return recordCodexPreStartFailure(durableCore, claim, failure, now);
    },
    /** @param {CodexExecutionClaim} claim */
    beginPreStartAttempt(claim) {
      assertClaim(claim);
      return beginCodexPreStartAttempt(durableCore, claim, now);
    },
    /** @param {CodexExecutionClaim} claim @param {number} processGroupId */
    trackProcessGroup(claim, processGroupId) {
      assertClaim(claim);
      if (!Number.isSafeInteger(processGroupId) || processGroupId < 1) {
        throw new TypeError("Codex execution process group is invalid");
      }
      const recordedAt = now();
      requireTimestamp(recordedAt);
      const identity = requireCodexProcessIdentity(
        readProcessIdentity(processGroupId),
      );
      const tracked = durableCore.transaction((transaction) =>
        transaction.run(
          `UPDATE codex_execution_queue
           SET process_group_id = ?, process_group_recorded_at = ?,
               process_boot_identity = ?, process_namespace_identity = ?,
               process_start_identity = ?
           WHERE work_id = ? AND work_kind = ?
             AND worker_id = ? AND fencing_token = ?
             AND started_at IS NOT NULL
             AND process_group_id IS NULL
             AND recovered_at IS NULL
             AND lease_expires_at > ?`,
          processGroupId,
          recordedAt,
          identity.bootIdentity,
          identity.namespaceIdentity,
          identity.startIdentity,
          claim.workId,
          claim.workKind,
          claim.workerId,
          claim.fencingToken,
          recordedAt,
        ),
      );
      if (tracked.changes !== 1) {
        claimLost(claim.workKind);
      }
      return { ...identity, processGroupId, recordedAt };
    },
    /** @param {CodexExecutionClaim} claim */
    finishProcessGroup(claim) {
      assertClaim(claim);
      const finishedAt = now();
      requireTimestamp(finishedAt);
      const finished = durableCore.transaction((transaction) =>
        transaction.run(
          `UPDATE codex_execution_queue
           SET process_group_finished_at = ?
           WHERE work_id = ? AND work_kind = ?
             AND worker_id = ? AND fencing_token = ?
             AND started_at IS NOT NULL
             AND process_group_id IS NOT NULL
             AND process_group_finished_at IS NULL
             AND recovered_at IS NULL
             AND lease_expires_at > ?`,
          finishedAt,
          claim.workId,
          claim.workKind,
          claim.workerId,
          claim.fencingToken,
          finishedAt,
        ),
      );
      if (finished.changes !== 1) {
        claimLost(claim.workKind);
      }
      return { finishedAt };
    },
    /** @param {CodexExecutionClaim} claim */
    release(claim) {
      assertClaim(claim);
      const releasedAt = now();
      requireTimestamp(releasedAt);
      const released = durableCore.transaction((transaction) =>
        transaction.run(
          `UPDATE codex_execution_queue SET lease_expires_at = ?
           WHERE work_id = ? AND work_kind = ?
             AND worker_id = ? AND fencing_token = ?
             AND retry_state = 'ready'
             AND started_at IS NULL AND lease_expires_at > ?`,
          releasedAt,
          claim.workId,
          claim.workKind,
          claim.workerId,
          claim.fencingToken,
          releasedAt,
        ),
      );
      if (released.changes !== 1) {
        claimLost(claim.workKind);
      }
      return { ...claim, leaseExpiresAt: releasedAt };
    },
    /**
     * @param {CodexExecutionClaim} claim
     * @param {string} codexCliVersion
     * @param {number} [processGroupId]
     */
    start(claim, codexCliVersion, processGroupId) {
      assertClaim(claim);
      return startCodexExecution(
        durableCore,
        claim,
        codexCliVersion,
        processGroupId,
        {
          claimLost: () => claimLost(claim.workKind),
          now,
          readProcessIdentity,
        },
      );
    },
    /**
     * @param {CodexExecutionClaim} claim
     * @param {string} codexCliVersion
     * @param {number} processGroupId
     */
    startTracked(claim, codexCliVersion, processGroupId) {
      if (!Number.isSafeInteger(processGroupId) || processGroupId < 1) {
        throw new TypeError("Codex execution process group is invalid");
      }
      return service.start(claim, codexCliVersion, processGroupId);
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
