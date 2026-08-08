(() => {
  "use strict";

  const EXECUTION_STATUSES = new Set([
    "queued",
    "running",
    "completed",
    "failed",
    "cancelled",
  ]);
  const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

  /** @param {unknown} value @returns {value is Record<string, any>} */
  function record(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  /** @param {unknown} value @param {string[]} keys */
  function validCounts(value, keys) {
    if (!record(value) || Object.keys(value).length !== keys.length) {
      return false;
    }
    return keys.every(
      (key) =>
        Number.isSafeInteger(value[key]) &&
        /** @type {number} */ (value[key]) >= 0,
    );
  }

  /** @param {unknown} value */
  function validNode(value) {
    if (!record(value) || !EXECUTION_STATUSES.has(value.status)) {
      return false;
    }
    if (value.kind === "system") {
      return (
        ["preparing", "finalizing"].includes(
          /** @type {string} */ (value.key),
        ) &&
        value.label === (value.key === "preparing" ? "Preparing" : "Finalizing")
      );
    }
    return (
      value.kind === "review" &&
      typeof value.label === "string" &&
      value.label.length > 0 &&
      typeof value.review_id === "string" &&
      value.review_id.length > 0 &&
      typeof value.review_version_id === "string" &&
      value.review_version_id.length > 0
    );
  }

  /** @param {unknown} value */
  function validMonitor(value) {
    if (
      !record(value) ||
      !Array.isArray(value.nodes) ||
      value.nodes.length < 2
    ) {
      return false;
    }
    const first = value.nodes[0];
    const last = value.nodes.at(-1);
    return (
      value.nodes.every(validNode) &&
      record(first) &&
      first.kind === "system" &&
      first.key === "preparing" &&
      record(last) &&
      last.kind === "system" &&
      last.key === "finalizing" &&
      validCounts(value.review_counts, [
        "total",
        "queued",
        "running",
        "completed",
        "failed",
        "cancelled",
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
        (Number.isSafeInteger(value.duration_ms) &&
          /** @type {number} */ (value.duration_ms) >= 0))
    );
  }

  /** @param {unknown} value */
  function validEvaluation(value) {
    return (
      record(value) &&
      typeof value.id === "string" &&
      value.id.length > 0 &&
      record(value.repository) &&
      typeof value.repository.id === "string" &&
      value.repository.id.length > 0 &&
      typeof value.repository.url === "string" &&
      EXECUTION_STATUSES.has(value.execution_status) &&
      ["pending", "clear", "advisory", "blocking", "error"].includes(
        /** @type {string} */ (value.effective_outcome),
      ) &&
      typeof value.created_at === "string" &&
      (value.completed_at === null || typeof value.completed_at === "string") &&
      validMonitor(value.monitor)
    );
  }

  /** @param {unknown} value */
  function validCollection(value) {
    return (
      record(value) &&
      Array.isArray(value.items) &&
      value.items.every(validEvaluation) &&
      (value.next_cursor === null || typeof value.next_cursor === "string")
    );
  }

  /** @param {unknown} status */
  function isTerminalStatus(status) {
    return typeof status === "string" && TERMINAL_STATUSES.has(status);
  }

  /**
   * @param {{action: "cancel" | "retry", csrfToken: string, evaluationId: string}} input
   */
  function mutate(input) {
    if (
      !record(input) ||
      !["cancel", "retry"].includes(/** @type {string} */ (input.action)) ||
      typeof input.csrfToken !== "string" ||
      input.csrfToken.length === 0 ||
      typeof input.evaluationId !== "string" ||
      input.evaluationId.length === 0
    ) {
      throw new TypeError("Evaluation monitor mutation is invalid");
    }
    return fetch(
      "/api/v1/evaluations/" +
        encodeURIComponent(input.evaluationId) +
        "/" +
        input.action,
      {
        headers: {
          ...(input.action === "retry"
            ? { "idempotency-key": crypto.randomUUID() }
            : {}),
          "x-quality-bar-csrf": input.csrfToken,
        },
        method: "POST",
      },
    );
  }

  Reflect.set(
    window,
    "qualityBarEvaluationMonitor",
    Object.freeze({
      isTerminalStatus,
      mutate,
      validCollection,
      validEvaluation,
    }),
  );
})();
