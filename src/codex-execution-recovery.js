import { DurableCoreError } from "./durable-error.js";
import { completeEvaluationIfTerminal } from "./evaluation-aggregation.js";
import {
  readCodexProcessIdentity,
  requireCodexProcessIdentity,
} from "./codex-process-identity.js";

const WORK_KINDS = new Set(["review_run", "waiver_adjudication"]);
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);
const PROCESS_TERMINATION_GRACE_MILLISECONDS = 5_000;
const PROCESS_TERMINATION_POLL_MILLISECONDS = 50;
const WAIT_SIGNAL = new Int32Array(new SharedArrayBuffer(4));
const RECOVERY_WORK_QUERY = `
  SELECT queue.work_id, queue.work_kind, queue.started_at,
         queue.process_group_id, queue.process_group_finished_at,
         queue.process_boot_identity, queue.process_namespace_identity,
         queue.process_start_identity,
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
  WHERE queue.started_at IS NULL OR queue.recovered_at IS NULL
  ORDER BY queue.ready_at, queue.work_id`;

/** @param {any} work */
export function classifyCodexExecutionRecovery(work) {
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

/** @param {unknown} value */
function requireRecoveryTime(value) {
  if (!Number.isSafeInteger(value) || /** @type {number} */ (value) < 0) {
    throw new TypeError("Codex execution recovery time is invalid");
  }
}

/** @param {unknown} error */
function processGroupAbsent(error) {
  return (
    error instanceof Error && "code" in error && String(error.code) === "ESRCH"
  );
}

/** @param {unknown} error */
function processGroupPermissionDenied(error) {
  return (
    error instanceof Error && "code" in error && String(error.code) === "EPERM"
  );
}

/** @param {() => boolean} isActive */
function waitForTrackedProcessGroupExit(isActive) {
  const deadline = Date.now() + PROCESS_TERMINATION_GRACE_MILLISECONDS;
  while (Date.now() < deadline) {
    Atomics.wait(
      WAIT_SIGNAL,
      0,
      0,
      Math.min(PROCESS_TERMINATION_POLL_MILLISECONDS, deadline - Date.now()),
    );
    if (!isActive()) {
      return true;
    }
  }
  return !isActive();
}

/**
 * @param {{bootIdentity: string, namespaceIdentity: string, startIdentity: string}} expected
 * @param {{bootIdentity: string, namespaceIdentity: string, startIdentity: string}} actual
 */
function sameProcessIdentity(expected, actual) {
  return (
    expected.bootIdentity === actual.bootIdentity &&
    expected.namespaceIdentity === actual.namespaceIdentity &&
    expected.startIdentity === actual.startIdentity
  );
}

/**
 * @param {{processGroupId: number, bootIdentity: string, namespaceIdentity: string, startIdentity: string}} tracked
 * @param {{
 *   killProcessGroup?: (processId: number, signal: NodeJS.Signals | 0) => unknown,
 *   readProcessIdentity?: typeof readCodexProcessIdentity,
 *   waitForExit?: (isActive: () => boolean) => boolean
 * }} [options]
 */
export function terminateTrackedCodexProcessGroup(
  tracked,
  {
    killProcessGroup = process.kill,
    readProcessIdentity = readCodexProcessIdentity,
    waitForExit = waitForTrackedProcessGroupExit,
  } = {},
) {
  const processGroupId = tracked?.processGroupId;
  if (
    !Number.isSafeInteger(processGroupId) ||
    processGroupId < 1 ||
    typeof killProcessGroup !== "function" ||
    typeof readProcessIdentity !== "function" ||
    typeof waitForExit !== "function"
  ) {
    throw new TypeError("Tracked Codex process group is invalid");
  }
  const expectedIdentity = requireCodexProcessIdentity(tracked);
  const target = -processGroupId;
  let terminationRequested = false;

  function isActive() {
    try {
      killProcessGroup(target, 0);
    } catch (error) {
      if (processGroupAbsent(error)) {
        return false;
      }
      if (terminationRequested && processGroupPermissionDenied(error)) {
        return false;
      }
      throw new DurableCoreError(
        "codex_execution_process_group_termination_failed",
        "Tracked Codex process group could not be inspected",
        { cause: error },
      );
    }
    let actualIdentity;
    try {
      actualIdentity = requireCodexProcessIdentity(
        readProcessIdentity(processGroupId),
      );
    } catch (error) {
      try {
        killProcessGroup(target, 0);
      } catch (inspectionError) {
        if (processGroupAbsent(inspectionError)) {
          return false;
        }
      }
      throw new DurableCoreError(
        "codex_execution_process_identity_unavailable",
        "Tracked Codex process identity could not be verified",
        { cause: error },
      );
    }
    if (!sameProcessIdentity(expectedIdentity, actualIdentity)) {
      throw new DurableCoreError(
        "codex_execution_process_identity_changed",
        "Tracked Codex process identity changed before recovery",
      );
    }
    return true;
  }

  if (!isActive()) {
    return null;
  }
  try {
    killProcessGroup(target, "SIGTERM");
    terminationRequested = true;
  } catch (error) {
    if (processGroupAbsent(error)) {
      return null;
    }
    throw new DurableCoreError(
      "codex_execution_process_group_termination_failed",
      "Tracked Codex process group could not be terminated",
      { cause: error },
    );
  }
  if (waitForExit(isActive)) {
    return "SIGTERM";
  }
  try {
    killProcessGroup(target, "SIGKILL");
    return "SIGKILL";
  } catch (error) {
    if (processGroupAbsent(error)) {
      return "SIGTERM";
    }
    throw new DurableCoreError(
      "codex_execution_process_group_termination_failed",
      "Tracked Codex process group could not be force-terminated",
      { cause: error },
    );
  }
}

/**
 * @param {{
 *   all(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): any[],
 *   transaction<Result>(callback: (transaction: any) => Result): Result
 * }} durableCore
 * @param {{
 *   now?: () => number,
 *   terminateProcessGroup?: (tracked: {processGroupId: number, bootIdentity: string, namespaceIdentity: string, startIdentity: string}) => NodeJS.Signals | null
 * }} [options]
 */
export function recoverCodexExecutions(
  durableCore,
  {
    now = () => Date.now(),
    terminateProcessGroup = terminateTrackedCodexProcessGroup,
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
  const work = durableCore.all(RECOVERY_WORK_QUERY).map((item) => {
    const recovery = classifyCodexExecutionRecovery(item);
    const terminationSignal =
      recovery !== "queued" &&
      item.process_group_finished_at === null &&
      Number.isSafeInteger(item.process_group_id)
        ? terminateProcessGroup({
            bootIdentity: item.process_boot_identity,
            namespaceIdentity: item.process_namespace_identity,
            processGroupId: item.process_group_id,
            startIdentity: item.process_start_identity,
          })
        : null;
    return { ...item, recovery, terminationSignal };
  });
  return durableCore.transaction((transaction) => {
    let interrupted = 0;
    let queued = 0;
    for (const item of work) {
      if (item.recovery === "queued") {
        queued += 1;
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
        transaction.run(
          `UPDATE codex_execution_queue
           SET recovery_termination_signal = ?, recovered_at = ?
           WHERE work_id = ? AND started_at IS NOT NULL
             AND recovered_at IS NULL`,
          item.terminationSignal,
          recoveredAt,
          item.work_id,
        );
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
          /** @type {string} */ (item.evaluation_id),
          recoveredAt,
        );
      }
    }
    return { interrupted, queued };
  });
}
