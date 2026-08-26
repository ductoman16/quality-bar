import { DurableCoreError } from "../durable/durable-error.ts";
import { readCodexExecutionConcurrency } from "./codex-execution-concurrency.ts";
import { requireCodexProcessIdentity } from "./codex-process-identity.ts";

const START_OWNERS = {
  review_run: {
    stateCode: "review_run_state_invalid",
    stateMessage: "Review Run is not queued for launch",
    table: "review_runs",
    versionMessage: "Review Run Codex CLI version is invalid",
  },
  waiver_adjudication: {
    stateCode: "waiver_adjudication_state_invalid",
    stateMessage: "Waiver Adjudication is not queued for launch",
    table: "waiver_adjudications",
    versionMessage: "Waiver Adjudication Codex CLI version is invalid",
  },
};

function countRunningCodexExecutions(transaction: any) {
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

export function startCodexExecution(
  durableCore: any,
  claim: {
    fencingToken: number;
    workerId: string;
    workId: string;
    workKind: "review_run" | "waiver_adjudication";
  },
  codexCliVersion: string,
  processGroupId: number | undefined,
  {
    claimLost,
    now,
    readProcessIdentity,
  }: {
    claimLost: () => never;
    now: () => number;
    readProcessIdentity: (processId: number) => unknown;
  },
) {
  const owner = START_OWNERS[claim.workKind];
  if (
    !owner ||
    typeof codexCliVersion !== "string" ||
    codexCliVersion.trim().length === 0
  ) {
    throw new TypeError(
      owner?.versionMessage ?? "Codex CLI version is invalid",
    );
  }
  if (
    processGroupId !== undefined &&
    (!Number.isSafeInteger(processGroupId) || processGroupId < 1)
  ) {
    throw new TypeError("Codex execution process group is invalid");
  }
  const identity =
    processGroupId === undefined
      ? undefined
      : requireCodexProcessIdentity(readProcessIdentity(processGroupId));
  const startedAt = now();
  if (!Number.isSafeInteger(startedAt) || startedAt < 0) {
    throw new TypeError("Codex execution claim time is invalid");
  }
  const started = durableCore.transaction((transaction: any) => {
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
        claimLost();
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
      claimLost();
    }
    if (
      identity &&
      transaction.run(
        `UPDATE codex_execution_queue
         SET process_group_id = ?, process_group_recorded_at = ?,
             process_boot_identity = ?, process_namespace_identity = ?,
             process_start_identity = ?
         WHERE work_id = ? AND work_kind = ?
           AND worker_id = ? AND fencing_token = ?
           AND started_at = ? AND process_group_id IS NULL`,
        processGroupId,
        startedAt,
        identity.bootIdentity,
        identity.namespaceIdentity,
        identity.startIdentity,
        claim.workId,
        claim.workKind,
        claim.workerId,
        claim.fencingToken,
        startedAt,
      ).changes !== 1
    ) {
      claimLost();
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
}
