import { count, httpsUrl, nonempty, record, timestamp } from "../contract.js";

export {
  validEvaluationResult,
  validReviewRunDiagnostics,
} from "./result-contract.js";

const EXECUTION_STATUSES = new Set([
  "cancelled",
  "completed",
  "failed",
  "queued",
  "running",
]);
const TERMINAL_STATUSES = new Set(["cancelled", "completed", "failed"]);

/** @param {any} value */
const validError = (value) =>
  record(value) && nonempty(value.code) && nonempty(value.detail);
/** @param {any} value */
const commit = (value) => /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(value);
/** @param {any} value */
const validSelector = (value) =>
  record(value) &&
  ["branch", "commit"].includes(value.type) &&
  nonempty(value.value) &&
  (value.type !== "commit" || commit(value.value));
/** @param {unknown} value @param {string[]} names */
function validCounts(value, names) {
  return (
    record(value) &&
    Object.keys(value).length === names.length &&
    names.every((name) => Number.isSafeInteger(value[name]) && value[name] >= 0)
  );
}

/** @param {unknown} value */
function validNode(value) {
  if (
    !record(value) ||
    !["review", "system"].includes(value.kind) ||
    typeof value.label !== "string" ||
    !EXECUTION_STATUSES.has(value.status)
  ) {
    return false;
  }
  return value.kind === "system"
    ? Object.keys(value).length === 4 &&
        value.label ===
          (value.key === "preparing" ? "Preparing" : "Finalizing") &&
        ["preparing", "finalizing"].includes(value.key)
    : Object.keys(value).length === 6 &&
        nonempty(value.review_id) &&
        nonempty(value.review_version_id) &&
        nonempty(value.label) &&
        (value.outcome === null ||
          ["clear", "advisory", "blocking", "error"].includes(value.outcome));
}

/** @param {unknown} value */
export function validMonitor(value) {
  return (
    record(value) &&
    Object.keys(value).length === 5 &&
    Array.isArray(value.nodes) &&
    value.nodes.length >= 2 &&
    value.nodes.every(validNode) &&
    value.nodes[0].kind === "system" &&
    value.nodes[0].key === "preparing" &&
    value.nodes.at(-1).kind === "system" &&
    value.nodes.at(-1).key === "finalizing" &&
    validCounts(value.review_counts, [
      "cancelled",
      "completed",
      "failed",
      "queued",
      "running",
      "total",
    ]) &&
    (value.outcome_counts === null ||
      validCounts(value.outcome_counts, [
        "clear",
        "triggered",
        "not_applicable",
        "error",
      ])) &&
    (value.finding_counts === null ||
      validCounts(value.finding_counts, ["total", "advisory", "blocking"])) &&
    (value.duration_ms === null ||
      (Number.isSafeInteger(value.duration_ms) && value.duration_ms >= 0)) &&
    value.review_counts.total ===
      value.nodes.filter((node) => node.kind === "review").length
  );
}

/** @param {unknown} value */
export function validEvaluation(value) {
  if (!record(value) || !record(value.repository) || !record(value.monitor)) {
    return false;
  }
  return (
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.repository.id === "string" &&
    value.repository.id.length > 0 &&
    httpsUrl(value.repository.url) &&
    ["automatic", "explicit"].includes(value.provenance) &&
    validSelector(value.base_selector) &&
    validSelector(value.head_selector) &&
    commit(value.base_commit) &&
    commit(value.head_commit) &&
    ["ready", "exhausted"].includes(value.retry_state) &&
    (value.retry_error === null || validError(value.retry_error)) &&
    count(value.pre_start_attempt_count) &&
    timestamp(value.exhausted_at) &&
    timestamp(value.next_attempt_at) &&
    EXECUTION_STATUSES.has(value.execution_status) &&
    ["pending", "clear", "advisory", "blocking", "error"].includes(
      value.effective_outcome,
    ) &&
    value.created_at !== null &&
    timestamp(value.created_at) &&
    timestamp(value.completed_at) &&
    validMonitor(value.monitor)
  );
}

export const validEvaluationMutation = (value, evaluationId, action) =>
  validEvaluation(value) &&
  value.id === evaluationId &&
  (action !== "cancel" || value.execution_status === "cancelled") &&
  (action !== "retry" || value.retry_state === "ready");

/** @param {unknown} value */
export function validCollection(value) {
  return (
    record(value) &&
    Array.isArray(value.items) &&
    value.items.every(validEvaluation) &&
    (value.next_cursor === null || typeof value.next_cursor === "string")
  );
}

/** @param {string} status */
export const isTerminalStatus = (status) => TERMINAL_STATUSES.has(status);

/** @param {unknown} node */
export function nodeVisualState(node) {
  if (!record(node)) {
    return "pending";
  }
  if (node.status === "failed" || node.outcome === "error") {
    return "error";
  }
  if (node.outcome === "blocking") {
    return "blocking";
  }
  if (node.outcome === "advisory") {
    return "advisory";
  }
  if (node.status === "completed") {
    return "complete";
  }
  return node.status === "running" ? "running" : "pending";
}

/** @param {string} action @param {string} evaluationId @param {string} csrf */
export function mutateEvaluation(action, evaluationId, csrf) {
  if (!["cancel", "retry"].includes(action) || !evaluationId || !csrf) {
    throw new TypeError("Evaluation monitor mutation is invalid");
  }
  return fetch(
    `/api/v1/evaluations/${encodeURIComponent(evaluationId)}/${action}`,
    {
      headers: {
        ...(action === "retry"
          ? { "idempotency-key": crypto.randomUUID() }
          : {}),
        "x-quality-bar-csrf": csrf,
      },
      method: "POST",
    },
  );
}
