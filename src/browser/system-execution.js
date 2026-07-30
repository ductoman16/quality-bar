"use strict";

const queue = document.getElementById("codex-execution-queue");
const running = document.getElementById("codex-execution-running");
const failures = document.getElementById("codex-execution-failures");
const concurrency = document.getElementById("codex-execution-concurrency");

/**
 * @typedef {{
 *   concurrency: {maximum_running: number, running_count: number, start_gate: string},
 *   failures: any[],
 *   queue: {count: number, rows: any[]},
 *   running: {count: number, rows: any[]}
 * }} SystemExecutionFacts
 */

/** @param {unknown} value */
function requireExecutionFacts(value) {
  if (!value || typeof value !== "object") {
    throw new Error("system_execution_facts_invalid");
  }
  const facts = /** @type {SystemExecutionFacts} */ (value);
  if (
    !facts.concurrency ||
    typeof facts.concurrency !== "object" ||
    !Number.isSafeInteger(facts.concurrency.maximum_running) ||
    !Number.isSafeInteger(facts.concurrency.running_count) ||
    !["available", "no_new_start"].includes(facts.concurrency.start_gate) ||
    !facts.queue ||
    typeof facts.queue !== "object" ||
    !Number.isSafeInteger(facts.queue.count) ||
    !Array.isArray(facts.queue.rows) ||
    !facts.running ||
    typeof facts.running !== "object" ||
    !Number.isSafeInteger(facts.running.count) ||
    !Array.isArray(facts.running.rows) ||
    !Array.isArray(facts.failures)
  ) {
    throw new Error("system_execution_facts_invalid");
  }
  return facts;
}

/** @param {any} row */
function resourceLabel(row) {
  if (
    typeof row.evaluation_id === "string" &&
    typeof row.review_run_id === "string"
  ) {
    return `Evaluation ${row.evaluation_id}; Review Run ${row.review_run_id}`;
  }
  if (typeof row.waiver_adjudication_id === "string") {
    return `Waiver Adjudication ${row.waiver_adjudication_id}`;
  }
  throw new Error("system_execution_resource_invalid");
}

/** @param {any} row */
function executionLabel(row) {
  if (
    !row ||
    typeof row !== "object" ||
    !["queued", "running"].includes(row.execution_status) ||
    typeof row.gate?.code !== "string" ||
    typeof row.lease?.status !== "string" ||
    !(
      row.lease.worker_id === null || typeof row.lease.worker_id === "string"
    ) ||
    !(
      row.lease.expires_at === null || typeof row.lease.expires_at === "string"
    ) ||
    !Number.isSafeInteger(row.lease.fencing_token) ||
    !Number.isSafeInteger(row.pre_start_attempt_count) ||
    !Number.isSafeInteger(row.retry_cycle) ||
    !["ready", "exhausted"].includes(row.retry_state) ||
    !(
      row.retry_error === null ||
      (typeof row.retry_error?.code === "string" &&
        typeof row.retry_error?.detail === "string")
    )
  ) {
    throw new Error("system_execution_row_invalid");
  }
  const parts = [
    resourceLabel(row),
    `State ${row.execution_status}`,
    `Gate ${row.gate.code}`,
    `Attempts ${row.pre_start_attempt_count} in cycle ${row.retry_cycle}`,
    `Retry ${row.retry_state}`,
    `Lease ${row.lease.status}; worker ${row.lease.worker_id ?? "none"}; fencing ${row.lease.fencing_token}; expires ${row.lease.expires_at ?? "none"}`,
  ];
  if (row.execution_status === "queued") {
    if (
      !Number.isSafeInteger(row.queue_position) ||
      !(row.next_attempt_at === null || typeof row.next_attempt_at === "string")
    ) {
      throw new Error("system_execution_queue_row_invalid");
    }
    parts.splice(1, 0, `Queue position ${row.queue_position}`);
    parts.push(`Next attempt ${row.next_attempt_at ?? "none"}`);
  }
  if (row.retry_error) {
    parts.push(`Failure ${row.retry_error.code}: ${row.retry_error.detail}`);
  }
  return parts.join(". ");
}

/** @param {any} failure */
function failureLabel(failure) {
  if (
    !failure ||
    typeof failure !== "object" ||
    typeof failure.completed_at !== "string" ||
    typeof failure.error?.code !== "string" ||
    typeof failure.error?.detail !== "string"
  ) {
    throw new Error("system_execution_failure_invalid");
  }
  return `${resourceLabel(failure)}. Failed ${failure.completed_at}. Failure ${failure.error.code}: ${failure.error.detail}`;
}

/** @param {HTMLElement} container @param {string[]} labels */
function replaceRows(container, labels) {
  container.replaceChildren(
    ...labels.map((text) => {
      const item = document.createElement("li");
      item.textContent = text;
      return item;
    }),
  );
}

/** @param {string} name @param {string | number} value */
function definition(name, value) {
  const term = document.createElement("dt");
  const description = document.createElement("dd");
  term.textContent = name;
  description.textContent = String(value);
  return [term, description];
}

document.addEventListener("quality-bar:system-loaded", (event) => {
  if (!queue || !running || !failures || !concurrency) {
    throw new Error("system_execution_controls_missing");
  }
  const facts = requireExecutionFacts(
    /** @type {any} */ (event).detail?.codex_execution,
  );
  if (
    facts.queue.count !== facts.queue.rows.length ||
    facts.running.count !== facts.running.rows.length
  ) {
    throw new Error("system_execution_counts_invalid");
  }
  const definitions = [
    ...definition("Maximum running", facts.concurrency.maximum_running),
    ...definition("Running", facts.concurrency.running_count),
    ...definition("Start gate", facts.concurrency.start_gate),
  ];
  const queueItems = facts.queue.rows.map(executionLabel);
  const runningItems = facts.running.rows.map(executionLabel);
  const failureItems = facts.failures.map(failureLabel);
  concurrency.replaceChildren(...definitions);
  replaceRows(queue, queueItems);
  replaceRows(running, runningItems);
  replaceRows(failures, failureItems);
});
