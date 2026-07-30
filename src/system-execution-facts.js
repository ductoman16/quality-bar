import { readCodexExecutionConcurrency } from "./codex-execution-concurrency.js";

/** @param {unknown} value */
function timestamp(value) {
  if (!Number.isSafeInteger(value) || /** @type {number} */ (value) < 0) {
    throw new TypeError("Codex execution timestamp is invalid");
  }
  return new Date(/** @type {number} */ (value)).toISOString();
}

/** @param {unknown} value */
function nullableTimestamp(value) {
  return value === null ? null : timestamp(value);
}

/** @param {any} row */
function requireExecutionRow(row) {
  if (
    !row ||
    !["review_run", "waiver_adjudication"].includes(row.work_kind) ||
    !["queued", "running"].includes(row.execution_status) ||
    !["ready", "exhausted"].includes(row.retry_state) ||
    !Number.isSafeInteger(row.ready_at) ||
    !Number.isSafeInteger(row.fencing_token) ||
    !Number.isSafeInteger(row.pre_start_attempt_count) ||
    !Number.isSafeInteger(row.retry_cycle) ||
    !(
      (row.worker_id === null && row.lease_expires_at === null) ||
      (typeof row.worker_id === "string" &&
        Number.isSafeInteger(row.lease_expires_at))
    ) ||
    !(
      (row.retry_error_code === null && row.retry_error_detail === null) ||
      (typeof row.retry_error_code === "string" &&
        typeof row.retry_error_detail === "string")
    )
  ) {
    throw new TypeError("Codex execution System row is invalid");
  }
  if (
    (row.work_kind === "review_run" &&
      (typeof row.evaluation_id !== "string" ||
        typeof row.review_run_id !== "string" ||
        row.waiver_adjudication_id !== null)) ||
    (row.work_kind === "waiver_adjudication" &&
      (typeof row.waiver_adjudication_id !== "string" ||
        row.evaluation_id !== null ||
        row.review_run_id !== null))
  ) {
    throw new TypeError("Codex execution System resource is invalid");
  }
  return row;
}

/** @param {any} row */
function requireFailureRow(row) {
  if (
    !row ||
    !["review_run", "waiver_adjudication"].includes(row.work_kind) ||
    typeof row.error_code !== "string" ||
    typeof row.error_detail !== "string" ||
    !Number.isSafeInteger(row.completed_at)
  ) {
    throw new TypeError("Codex execution System failure is invalid");
  }
  if (
    (row.work_kind === "review_run" &&
      (typeof row.evaluation_id !== "string" ||
        typeof row.review_run_id !== "string" ||
        row.waiver_adjudication_id !== null)) ||
    (row.work_kind === "waiver_adjudication" &&
      (typeof row.waiver_adjudication_id !== "string" ||
        row.evaluation_id !== null ||
        row.review_run_id !== null))
  ) {
    throw new TypeError("Codex execution System failure resource is invalid");
  }
  return row;
}

/** @param {any} row @param {number} now @param {number} occupiedCount @param {number} maximumRunning @param {{error?: string, status: string}} codex @param {{status?: string}} storage */
function queueGate(row, now, occupiedCount, maximumRunning, codex, storage) {
  if (row.retry_state === "exhausted") {
    return "retry_exhausted";
  }
  if (codex.status === "unavailable") {
    if (typeof codex.error !== "string") {
      throw new TypeError("Codex System failure is invalid");
    }
    return codex.error;
  }
  if (storage.status === "unavailable") {
    return "storage_unavailable";
  }
  if (row.ready_at > now) {
    return "retry_delayed";
  }
  if (row.worker_id !== null) {
    return row.lease_expires_at <= now ? "lease_stuck" : "lease_held";
  }
  return occupiedCount >= maximumRunning ? "no_new_start" : "ready";
}

/** @param {any} row @param {"queued" | "running"} status @param {number} now */
function leaseStatus(row, status, now) {
  if (status === "running") {
    return "running";
  }
  if (row.worker_id === null) {
    return "unclaimed";
  }
  if (row.retry_state === "exhausted" || row.ready_at > now) {
    return "released";
  }
  return row.lease_expires_at <= now ? "stuck" : "held";
}

/** @param {any} row @param {"queued" | "running"} status @param {number | null} queuePosition @param {string} gate @param {number} now */
function executionDocument(row, status, queuePosition, gate, now) {
  const document = {
    execution_status: status,
    gate: { code: gate },
    lease: {
      expires_at: nullableTimestamp(row.lease_expires_at),
      fencing_token: row.fencing_token,
      status: leaseStatus(row, status, now),
      worker_id: row.worker_id,
    },
    pre_start_attempt_count: row.pre_start_attempt_count,
    retry_cycle: row.retry_cycle,
    retry_error:
      row.retry_error_code === null
        ? null
        : { code: row.retry_error_code, detail: row.retry_error_detail },
    retry_state: row.retry_state,
    ...(status === "queued"
      ? {
          next_attempt_at:
            row.retry_state === "ready" ? timestamp(row.ready_at) : null,
          queue_position: queuePosition,
        }
      : {}),
    ...(row.work_kind === "review_run"
      ? {
          evaluation_id: row.evaluation_id,
          review_run_id: row.review_run_id,
        }
      : { waiver_adjudication_id: row.waiver_adjudication_id }),
  };
  return document;
}

const ACTIVE_EXECUTIONS = `
  SELECT queue.work_id, queue.work_kind, queue.ready_at, queue.retry_state,
         queue.worker_id, queue.fencing_token, queue.lease_expires_at,
         review_runs.evaluation_id, review_runs.id AS review_run_id,
         NULL AS waiver_adjudication_id, review_runs.execution_status,
         review_runs.retry_cycle,
         (SELECT count(*) FROM review_run_pre_start_attempts
          WHERE review_run_id = review_runs.id
            AND retry_cycle = review_runs.retry_cycle) AS pre_start_attempt_count,
         (SELECT error_code FROM review_run_pre_start_attempts
          WHERE review_run_id = review_runs.id
            AND retry_cycle = review_runs.retry_cycle
          ORDER BY attempt_number DESC LIMIT 1) AS retry_error_code,
         (SELECT error_detail FROM review_run_pre_start_attempts
          WHERE review_run_id = review_runs.id
            AND retry_cycle = review_runs.retry_cycle
          ORDER BY attempt_number DESC LIMIT 1) AS retry_error_detail
    FROM codex_execution_queue AS queue
    JOIN review_runs ON queue.work_kind = 'review_run'
                 AND review_runs.id = queue.work_id
   WHERE review_runs.execution_status IN ('queued', 'running')
  UNION ALL
  SELECT queue.work_id, queue.work_kind, queue.ready_at, queue.retry_state,
         queue.worker_id, queue.fencing_token, queue.lease_expires_at,
         NULL AS evaluation_id, NULL AS review_run_id,
         waiver_adjudications.id AS waiver_adjudication_id,
         waiver_adjudications.execution_status, waiver_adjudications.retry_cycle,
         (SELECT count(*) FROM waiver_adjudication_pre_start_attempts
          WHERE waiver_adjudication_id = waiver_adjudications.id
            AND retry_cycle = waiver_adjudications.retry_cycle) AS pre_start_attempt_count,
         (SELECT error_code FROM waiver_adjudication_pre_start_attempts
          WHERE waiver_adjudication_id = waiver_adjudications.id
            AND retry_cycle = waiver_adjudications.retry_cycle
          ORDER BY attempt_number DESC LIMIT 1) AS retry_error_code,
         (SELECT error_detail FROM waiver_adjudication_pre_start_attempts
          WHERE waiver_adjudication_id = waiver_adjudications.id
            AND retry_cycle = waiver_adjudications.retry_cycle
          ORDER BY attempt_number DESC LIMIT 1) AS retry_error_detail
    FROM codex_execution_queue AS queue
    JOIN waiver_adjudications
      ON queue.work_kind = 'waiver_adjudication'
     AND waiver_adjudications.id = queue.work_id
   WHERE waiver_adjudications.execution_status IN ('queued', 'running')`;

const EXECUTION_FAILURES = `
  SELECT 'review_run' AS work_kind, review_runs.evaluation_id,
         review_runs.id AS review_run_id, NULL AS waiver_adjudication_id,
         review_runs.error_code, review_runs.error_detail, review_runs.completed_at
    FROM review_runs WHERE execution_status = 'failed'
  UNION ALL
  SELECT 'waiver_adjudication' AS work_kind, NULL AS evaluation_id,
         NULL AS review_run_id, waiver_adjudications.id AS waiver_adjudication_id,
         waiver_adjudications.error_code, waiver_adjudications.error_detail,
         waiver_adjudications.completed_at
    FROM waiver_adjudications WHERE execution_status = 'failed'
  ORDER BY completed_at, work_kind, review_run_id, waiver_adjudication_id`;

/**
 * @param {{ all: (sql: string) => any[], get: (sql: string) => any }} durableCore
 * @param {{ codex: {error?: string, status: string}, now: number, storage: {status?: string} }} facts
 */
export function readSystemCodexExecutionFacts(
  durableCore,
  { codex, now, storage },
) {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new TypeError("Codex execution System time is invalid");
  }
  if (!codex || !["available", "unavailable"].includes(codex.status)) {
    throw new TypeError("Codex System capability is invalid");
  }
  const maximumRunning = readCodexExecutionConcurrency(durableCore);
  const active = durableCore.all(ACTIVE_EXECUTIONS).map(requireExecutionRow);
  const running = active.filter((row) => row.execution_status === "running");
  const queued = active
    .filter((row) => row.execution_status === "queued")
    .sort(
      (left, right) =>
        left.ready_at - right.ready_at ||
        left.work_id.localeCompare(right.work_id),
    );
  const runningCount = running.length;
  const occupiedCount =
    runningCount +
    queued.filter((row) => row.worker_id !== null && row.lease_expires_at > now)
      .length;
  const queueRows = queued.map((row, index) =>
    executionDocument(
      row,
      "queued",
      index + 1,
      queueGate(row, now, occupiedCount, maximumRunning, codex, storage),
      now,
    ),
  );
  const runningRows = running
    .sort((left, right) => left.work_id.localeCompare(right.work_id))
    .map((row) => executionDocument(row, "running", null, "running", now));
  const failures = durableCore
    .all(EXECUTION_FAILURES)
    .map(requireFailureRow)
    .map((row) => ({
      completed_at: timestamp(row.completed_at),
      error: { code: row.error_code, detail: row.error_detail },
      ...(row.work_kind === "review_run"
        ? { evaluation_id: row.evaluation_id, review_run_id: row.review_run_id }
        : { waiver_adjudication_id: row.waiver_adjudication_id }),
    }));
  return {
    concurrency: {
      maximum_running: maximumRunning,
      running_count: runningCount,
      start_gate:
        occupiedCount >= maximumRunning ? "no_new_start" : "available",
    },
    failures,
    queue: { count: queueRows.length, rows: queueRows },
    running: { count: runningRows.length, rows: runningRows },
  };
}
