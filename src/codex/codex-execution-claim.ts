import { DurableCoreError } from "../durable/durable-error.ts";
import { readCodexExecutionConcurrency } from "./codex-execution-concurrency.ts";
import {
  readCodexProcessIdentity,
  requireCodexProcessIdentity,
} from "./codex-process-identity.ts";
import { startCodexExecution } from "./codex-execution-start.ts";
import {
  beginCodexPreStartAttempt,
  recordCodexPreStartFailure,
  recoverInterruptedCodexPreStartAttempt,
} from "./codex-execution-pre-start.ts";

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

export type CodexExecutionKind = "review_run" | "waiver_adjudication";
export type CodexExecutionClaim = {
  fencingToken: number;
  leaseExpiresAt: number;
  workerId: string;
  workId: string;
  workKind: CodexExecutionKind;
};

function requireNonblank(value: unknown, message: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(message);
  }
}

function requireTimestamp(value: unknown) {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError("Codex execution claim time is invalid");
  }
}

function requireWorkKind(value: unknown): asserts value is CodexExecutionKind {
  if (value !== "review_run" && value !== "waiver_adjudication") {
    throw new DurableCoreError(
      "codex_execution_kind_invalid",
      "Queued Codex execution kind is invalid",
    );
  }
}

function assertClaim(claim: CodexExecutionClaim) {
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

export function createCodexExecutionClaimService(
  durableCore: {
    transaction: (callback: (transaction: any) => any) => any;
  },
  {
    clearInterval: cancelInterval = (timer) =>
      clearInterval(timer as NodeJS.Timeout),
    createWorkerId,
    now,
    readProcessIdentity = readCodexProcessIdentity,
    setInterval: scheduleInterval = setInterval,
  }: {
    clearInterval?: (timer: unknown) => void;
    createWorkerId: () => string;
    now: () => number;
    readProcessIdentity?: typeof readCodexProcessIdentity;
    setInterval?: (callback: () => void, milliseconds: number) => unknown;
  },
) {
  function claimLost(workKind: CodexExecutionKind): never {
    const owner = WORK_OWNERS[workKind];
    throw new DurableCoreError(owner.claimLostCode, owner.claimLostMessage);
  }

  const service = {
    claimNext(): CodexExecutionClaim | undefined {
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
    renew(claim: CodexExecutionClaim) {
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
    recordPreStartFailure(claim: CodexExecutionClaim, failure: unknown) {
      assertClaim(claim);
      return recordCodexPreStartFailure(durableCore, claim, failure, now);
    },
    beginPreStartAttempt(claim: CodexExecutionClaim) {
      assertClaim(claim);
      return beginCodexPreStartAttempt(durableCore, claim, now);
    },
    trackProcessGroup(claim: CodexExecutionClaim, processGroupId: number) {
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
    finishProcessGroup(claim: CodexExecutionClaim) {
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
    release(claim: CodexExecutionClaim) {
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
    start(
      claim: CodexExecutionClaim,
      codexCliVersion: string,
      processGroupId?: number,
    ) {
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
    startTracked(
      claim: CodexExecutionClaim,
      codexCliVersion: string,
      processGroupId: number,
    ) {
      if (!Number.isSafeInteger(processGroupId) || processGroupId < 1) {
        throw new TypeError("Codex execution process group is invalid");
      }
      return service.start(claim, codexCliVersion, processGroupId);
    },
    startRenewal(
      claim: CodexExecutionClaim,
      onClaimLost: (error: unknown) => void,
    ) {
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
