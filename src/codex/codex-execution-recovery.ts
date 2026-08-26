import { DurableCoreError } from "../durable/durable-error.ts";
import { completeEvaluationIfTerminal } from "../evaluation/evaluation-aggregation.ts";
import { terminateTrackedCodexProcessGroup } from "./codex-execution-process-recovery.ts";
import { recoverInterruptedCodexPreStartAttempt } from "./codex-execution-pre-start.ts";

export { terminateTrackedCodexProcessGroup };

const WORK_KINDS = new Set(["review_run", "waiver_adjudication"]);
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);
const RECOVERY_WORK_QUERY = `
  SELECT queue.work_id, queue.work_kind, queue.started_at,
         queue.process_group_id, queue.process_group_finished_at,
         queue.process_boot_identity, queue.process_namespace_identity,
         queue.process_start_identity, queue.recovery_termination_signal,
         queue.recovered_at,
         CASE queue.work_kind
           WHEN 'review_run' THEN review_runs.execution_status
           WHEN 'waiver_adjudication' THEN waiver_adjudications.execution_status
         END AS execution_status,
         review_runs.evaluation_id
  FROM codex_execution_queue AS queue
  LEFT JOIN review_runs
    ON queue.work_kind = 'review_run'
   AND review_runs.id = queue.work_id
  LEFT JOIN waiver_adjudications
    ON queue.work_kind = 'waiver_adjudication'
   AND waiver_adjudications.id = queue.work_id
  WHERE queue.started_at IS NULL
     OR queue.recovered_at IS NULL
     OR review_runs.execution_status = 'running'
     OR waiver_adjudications.execution_status = 'running'
  ORDER BY queue.ready_at, queue.work_id`;

export function classifyCodexExecutionRecovery(work: any) {
  if (
    !WORK_KINDS.has(work?.work_kind) ||
    !["queued", "running", ...TERMINAL_STATUSES].includes(
      work?.execution_status,
    ) ||
    !(
      work?.started_at === null ||
      (Number.isSafeInteger(work?.started_at) && work.started_at >= 0)
    )
  ) {
    throw new DurableCoreError(
      "codex_execution_recovery_state_invalid",
      "Codex execution recovery state is invalid",
    );
  }
  if (work.started_at === null && work.execution_status === "queued") {
    return "queued";
  }
  if (
    work.started_at !== null &&
    TERMINAL_STATUSES.has(work.execution_status)
  ) {
    return "terminal";
  }
  if (work.started_at !== null && work.execution_status === "running") {
    return "interrupted";
  }
  throw new DurableCoreError(
    "codex_execution_recovery_state_invalid",
    "Codex execution recovery state is invalid",
  );
}

function requireRecoveryTime(value: unknown) {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError("Codex execution recovery time is invalid");
  }
}

function persistTerminationOutcome(
  durableCore: {
    transaction<Result>(callback: (transaction: any) => Result): Result;
  },
  item: any,
  terminationSignal: NodeJS.Signals | null,
  recoveredAt: number,
) {
  return durableCore.transaction((transaction) => {
    const updated = transaction.run(
      `UPDATE codex_execution_queue
       SET recovery_termination_signal = ?, recovered_at = ?
       WHERE work_id = ? AND started_at IS NOT NULL
         AND process_group_id = ? AND recovered_at IS NULL`,
      terminationSignal,
      recoveredAt,
      item.work_id,
      item.process_group_id,
    );
    if (updated.changes !== 1) {
      throw new DurableCoreError(
        "codex_execution_recovery_state_changed",
        "Codex execution recovery state changed",
      );
    }
  });
}

export function recoverCodexExecutions(
  durableCore: {
    all(
      sql: string,
      ...parameters: import("node:sqlite").SQLInputValue[]
    ): any[];
    transaction<Result>(callback: (transaction: any) => Result): Result;
  },
  {
    now = () => Date.now(),
    terminateProcessGroup = terminateTrackedCodexProcessGroup,
  }: {
    now?: () => number;
    terminateProcessGroup?: (tracked: {
      processGroupId: number;
      bootIdentity: string;
      namespaceIdentity: string;
      startIdentity: string;
    }) => NodeJS.Signals | null;
  } = {},
) {
  if (
    typeof durableCore?.all !== "function" ||
    typeof durableCore?.transaction !== "function" ||
    typeof now !== "function" ||
    typeof terminateProcessGroup !== "function"
  ) {
    throw new TypeError("Codex execution recovery dependencies are invalid");
  }
  const recoveredAt = now();
  requireRecoveryTime(recoveredAt);
  const work = durableCore.all(RECOVERY_WORK_QUERY).map((item) => ({
    ...item,
    recovery: classifyCodexExecutionRecovery(item),
    terminationPersisted: item.recovered_at !== null,
    terminationSignal: item.recovery_termination_signal,
  }));
  for (const item of work) {
    if (
      item.recovery !== "queued" &&
      !item.terminationPersisted &&
      item.process_group_finished_at === null &&
      !Number.isSafeInteger(item.process_group_id)
    ) {
      throw new DurableCoreError(
        "codex_execution_process_identity_unavailable",
        "Tracked Codex process identity could not be verified",
      );
    }
    if (
      item.recovery !== "queued" &&
      !item.terminationPersisted &&
      item.process_group_finished_at === null &&
      Number.isSafeInteger(item.process_group_id)
    ) {
      item.terminationSignal = terminateProcessGroup({
        bootIdentity: item.process_boot_identity,
        namespaceIdentity: item.process_namespace_identity,
        processGroupId: item.process_group_id,
        startIdentity: item.process_start_identity,
      });
      persistTerminationOutcome(
        durableCore,
        item,
        item.terminationSignal,
        recoveredAt,
      );
      item.terminationPersisted = true;
    }
  }
  return durableCore.transaction((transaction) => {
    let interrupted = 0;
    let queued = 0;
    for (const item of work) {
      if (item.recovery === "queued") {
        queued += 1;
        if (
          recoverInterruptedCodexPreStartAttempt(transaction, item, recoveredAt)
        ) {
          continue;
        }
        transaction.run(
          `UPDATE codex_execution_queue
           SET lease_expires_at = ?
           WHERE work_id = ? AND started_at IS NULL
             AND worker_id IS NOT NULL`,
          recoveredAt,
          item.work_id,
        );
        continue;
      }
      const table =
        item.work_kind === "review_run"
          ? "review_runs"
          : "waiver_adjudications";
      if (item.recovery === "terminal") {
        if (!item.terminationPersisted) {
          transaction.run(
            `UPDATE codex_execution_queue
             SET recovery_termination_signal = ?, recovered_at = ?
             WHERE work_id = ? AND started_at IS NOT NULL
               AND recovered_at IS NULL`,
            item.terminationSignal,
            recoveredAt,
            item.work_id,
          );
        }
        continue;
      }
      const owner =
        item.work_kind === "review_run"
          ? {
              detail: "Review Run was interrupted by application restart",
              table,
            }
          : {
              detail:
                "Waiver Adjudication was interrupted by application restart",
              table,
            };
      if (
        transaction.run(
          `UPDATE ${owner.table}
           SET execution_status = 'failed', completed_at = ?,
               error_code = 'unexpected_execution_failure',
               error_detail = ?
           WHERE id = ? AND execution_status = 'running'`,
          recoveredAt,
          owner.detail,
          item.work_id,
        ).changes !== 1
      ) {
        throw new DurableCoreError(
          "codex_execution_recovery_state_changed",
          "Codex execution recovery state changed",
        );
      }
      interrupted += 1;
      if (
        !item.terminationPersisted &&
        transaction.run(
          `UPDATE codex_execution_queue
           SET recovery_termination_signal = ?, recovered_at = ?
           WHERE work_id = ? AND started_at IS NOT NULL
             AND recovered_at IS NULL`,
          item.terminationSignal,
          recoveredAt,
          item.work_id,
        ).changes !== 1
      ) {
        throw new DurableCoreError(
          "codex_execution_recovery_state_changed",
          "Codex execution recovery state changed",
        );
      }
      if (item.work_kind === "review_run") {
        completeEvaluationIfTerminal(
          transaction,
          item.evaluation_id as string,
          recoveredAt,
        );
      }
    }
    return { interrupted, queued };
  });
}
