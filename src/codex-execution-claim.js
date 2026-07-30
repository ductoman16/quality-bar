import { DurableCoreError } from "./durable-error.js";

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
        const queued = transaction.get(
          `SELECT work_id, work_kind, fencing_token
           FROM codex_execution_queue
           WHERE started_at IS NULL
             AND retry_state = 'ready'
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
    /** @param {CodexExecutionClaim} claim @param {string} codexCliVersion */
    start(claim, codexCliVersion) {
      assertClaim(claim);
      const owner = WORK_OWNERS[claim.workKind];
      requireNonblank(codexCliVersion, owner.versionMessage);
      const startedAt = now();
      requireTimestamp(startedAt);
      return durableCore.transaction((transaction) => {
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
      });
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
