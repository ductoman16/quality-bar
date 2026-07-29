import { DurableCoreError } from "./durable-error.js";
import {
  REVIEW_RUN_LEASE_MILLISECONDS,
  REVIEW_RUN_RENEWAL_MILLISECONDS,
} from "./review-run-claim.js";

/** @param {unknown} value @param {string} name */
function requireIdentity(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`Waiver Adjudication ${name} is invalid`);
  }
}

/** @param {unknown} value @param {string} name */
function requireTimestamp(value, name) {
  if (!Number.isSafeInteger(value) || /** @type {number} */ (value) < 0) {
    throw new TypeError(`Waiver Adjudication ${name} is invalid`);
  }
}

/** @param {any} claim */
function assertClaim(claim) {
  requireIdentity(claim?.workId, "claim");
  requireIdentity(claim?.workerId, "worker identity");
  if (!Number.isSafeInteger(claim.fencingToken) || claim.fencingToken < 1) {
    throw new TypeError("Waiver Adjudication claim is invalid");
  }
}

/** @param {any} durableCore @param {any} options */
export function createWaiverAdjudicationClaimService(
  durableCore,
  {
    clearInterval: cancelInterval = clearInterval,
    createWorkerId,
    now,
    setInterval: scheduleInterval = setInterval,
  },
) {
  /** @returns {never} */
  function claimLost() {
    throw new DurableCoreError(
      "waiver_adjudication_claim_lost",
      "Waiver Adjudication claim is no longer authoritative",
    );
  }
  const service = {
    claimNext() {
      const claimedAt = now();
      const workerId = createWorkerId();
      requireTimestamp(claimedAt, "claim time");
      requireIdentity(workerId, "worker identity");
      const leaseExpiresAt = claimedAt + REVIEW_RUN_LEASE_MILLISECONDS;
      return durableCore.transaction((/** @type {any} */ transaction) => {
        const queued = transaction.get(
          `SELECT work_id, fencing_token
           FROM codex_execution_queue
           WHERE work_kind = 'waiver_adjudication'
             AND started_at IS NULL AND ready_at <= ?
             AND (worker_id IS NULL OR lease_expires_at <= ?)
           ORDER BY ready_at, work_id LIMIT 1`,
          claimedAt,
          claimedAt,
        );
        if (!queued) {
          return undefined;
        }
        const fencingToken = queued.fencing_token + 1;
        if (
          transaction.run(
            `UPDATE codex_execution_queue
             SET worker_id = ?, fencing_token = ?, lease_expires_at = ?
             WHERE work_id = ? AND work_kind = 'waiver_adjudication'
               AND fencing_token = ? AND started_at IS NULL
               AND (worker_id IS NULL OR lease_expires_at <= ?)`,
            workerId,
            fencingToken,
            leaseExpiresAt,
            queued.work_id,
            queued.fencing_token,
            claimedAt,
          ).changes !== 1
        ) {
          claimLost();
        }
        return {
          fencingToken,
          leaseExpiresAt,
          workerId,
          workId: queued.work_id,
        };
      });
    },
    /** @param {any} claim */
    renew(claim) {
      assertClaim(claim);
      const renewedAt = now();
      requireTimestamp(renewedAt, "renewal time");
      const leaseExpiresAt = renewedAt + REVIEW_RUN_LEASE_MILLISECONDS;
      if (
        durableCore.run(
          `UPDATE codex_execution_queue SET lease_expires_at = ?
           WHERE work_id = ? AND work_kind = 'waiver_adjudication'
             AND worker_id = ? AND fencing_token = ?
             AND lease_expires_at > ?`,
          leaseExpiresAt,
          claim.workId,
          claim.workerId,
          claim.fencingToken,
          renewedAt,
        ).changes !== 1
      ) {
        claimLost();
      }
      return { ...claim, leaseExpiresAt };
    },
    /** @param {any} claim @param {string} codexCliVersion */
    start(claim, codexCliVersion) {
      assertClaim(claim);
      requireIdentity(codexCliVersion, "Codex CLI version");
      const startedAt = now();
      requireTimestamp(startedAt, "start time");
      durableCore.transaction((/** @type {any} */ transaction) => {
        if (
          transaction.run(
            `UPDATE codex_execution_queue SET started_at = ?
             WHERE work_id = ? AND work_kind = 'waiver_adjudication'
               AND worker_id = ? AND fencing_token = ?
               AND started_at IS NULL AND lease_expires_at > ?`,
            startedAt,
            claim.workId,
            claim.workerId,
            claim.fencingToken,
            startedAt,
          ).changes !== 1
        ) {
          claimLost();
        }
        if (
          transaction.run(
            `UPDATE waiver_adjudications
             SET execution_status = 'running', started_at = ?,
                 codex_cli_version = ?
             WHERE id = ? AND execution_status = 'queued'`,
            startedAt,
            codexCliVersion,
            claim.workId,
          ).changes !== 1
        ) {
          throw new DurableCoreError(
            "waiver_adjudication_state_invalid",
            "Waiver Adjudication is not queued for launch",
          );
        }
      });
    },
    /** @param {any} claim @param {(error: unknown) => void} onClaimLost */
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
