const EXECUTION_STATUSES = new Set([
  "cancelled",
  "completed",
  "failed",
  "queued",
  "running",
]);
const TERMINAL_STATUSES = new Set(["cancelled", "completed", "failed"]);

/** @param {unknown} value @returns {value is Record<string, any>} */
const record = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** @param {unknown} value @param {string[]} names */
function validCounts(value, names) {
  return (
    record(value) &&
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
    ? typeof value.key === "string"
    : typeof value.review_id === "string" &&
        typeof value.review_version_id === "string" &&
        (value.outcome === null ||
          ["clear", "triggered", "not_applicable", "error"].includes(
            value.outcome,
          ));
}

/** @param {unknown} value */
export function validMonitor(value) {
  return (
    record(value) &&
    Array.isArray(value.nodes) &&
    value.nodes.every(validNode) &&
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
    typeof value.repository.url === "string" &&
    EXECUTION_STATUSES.has(value.execution_status) &&
    ["pending", "clear", "advisory", "blocking", "error"].includes(
      value.effective_outcome,
    ) &&
    typeof value.created_at === "string" &&
    (value.completed_at === null || typeof value.completed_at === "string") &&
    validMonitor(value.monitor)
  );
}

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
