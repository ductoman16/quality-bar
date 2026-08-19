// @ts-nocheck
(() => {
  const monitor = Reflect.get(window, "qualityBarEvaluationMonitor");
  if (
    !monitor ||
    typeof monitor.isTerminalStatus !== "function" ||
    typeof monitor.mutate !== "function" ||
    typeof monitor.validEvaluation !== "function"
  ) {
    throw new Error("evaluation_monitor_boundary_unavailable");
  }
  let currentEvaluation;
  let refreshing = false;
  let resultRendered = false;

  /** @param {string} id */
  function element(id) {
    const value = document.getElementById(id);
    if (!value) {
      throw new Error("evaluation_detail_control_unavailable");
    }
    return value;
  }

  /** @param {number | null} duration */
  function durationText(duration) {
    if (duration === null) {
      return "In progress";
    }
    if (!Number.isSafeInteger(duration) || duration < 0) {
      throw new Error("evaluation_detail_invalid");
    }
    return (duration / 1000).toFixed(duration < 10_000 ? 1 : 0) + " s";
  }

  /** @param {string} message */
  function showError(message) {
    const error = element("evaluation-detail-error");
    error.textContent = message;
    error.hidden = false;
  }

  function clearError() {
    const error = element("evaluation-detail-error");
    error.textContent = "";
    error.hidden = true;
  }

  /** @param {any} evaluation */
  function renderTimeline(evaluation) {
    const timeline = element("evaluation-detail-timeline");
    timeline.replaceChildren();
    for (const node of evaluation.monitor.nodes) {
      const item = document.createElement("li");
      item.className = "qb-timeline-node qb-timeline-node--" + node.kind;
      const marker = document.createElement("span");
      marker.className = "qb-timeline-node__marker";
      marker.setAttribute("aria-hidden", "true");
      const text = document.createElement("span");
      const label =
        node.kind === "review" ? "Review " + node.label : node.label;
      text.textContent = label + " — ";
      const status = document.createElement("span");
      if (node.kind === "review" && typeof node.outcome === "string") {
        // Fold each review's outcome onto its dot with the shared glyph.
        status.className =
          "qb-timeline-node__status evaluation-status--" + node.outcome;
        const icon = document.createElement("span");
        icon.className = "evaluation-status__icon";
        icon.setAttribute("aria-hidden", "true");
        const outcomeLabel = document.createElement("span");
        outcomeLabel.textContent = node.outcome;
        status.append(icon, outcomeLabel);
      } else {
        status.className = "qb-timeline-node__status";
        status.textContent = node.status;
      }
      text.append(status);
      item.append(marker);
      item.append(text);
      timeline.append(item);
    }
  }

  /** @param {any} evaluation */
  function renderEvaluation(evaluation) {
    currentEvaluation = evaluation;
    element("evaluation-detail-title").textContent =
      "Evaluation " + evaluation.id;
    element("evaluation-detail-repository").textContent =
      evaluation.repository.url;
    element("evaluation-detail-source").textContent =
      typeof evaluation.provenance === "string"
        ? evaluation.provenance
        : "Unknown";
    element("evaluation-detail-status").textContent =
      evaluation.execution_status;
    element("evaluation-detail-outcome").textContent =
      evaluation.effective_outcome;
    element("evaluation-detail-duration").textContent = durationText(
      evaluation.monitor.duration_ms,
    );
    element("evaluation-detail-updated").textContent =
      new Date().toLocaleTimeString();
    const cancel = element("evaluation-detail-cancel");
    const retry = element("evaluation-detail-retry");
    cancel.hidden = !["queued", "running"].includes(
      evaluation.execution_status,
    );
    retry.hidden = evaluation.retry_state !== "exhausted";
    if (
      !monitor.isTerminalStatus(evaluation.execution_status) &&
      resultRendered
    ) {
      element("evaluation-detail-result").replaceChildren();
      resultRendered = false;
    }
    renderTimeline(evaluation);
  }

  /** @param {Response} response */
  async function responseMessage(response, fallback) {
    try {
      const body = await response.json();
      return typeof body?.error?.message === "string"
        ? body.error.message
        : fallback;
    } catch {
      return fallback;
    }
  }

  async function loadResult() {
    if (
      resultRendered ||
      !currentEvaluation ||
      !["completed", "failed"].includes(currentEvaluation.execution_status)
    ) {
      return;
    }
    let response;
    try {
      response = await fetch(
        "/api/v1/evaluations/" +
          encodeURIComponent(currentEvaluation.id) +
          "/result",
      );
    } catch {
      showError("Result failed to load");
      return;
    }
    if (response.status === 409) {
      return;
    }
    if (!response.ok) {
      showError(await responseMessage(response, "Result failed to load"));
      return;
    }
    let result;
    try {
      result = await response.json();
      const renderer = window.qualityBarEvaluationResult?.render;
      if (typeof renderer !== "function") {
        throw new Error("evaluation_result_boundary_unavailable");
      }
      await renderer(
        element("evaluation-detail-result"),
        currentEvaluation,
        result,
        window.location.search,
        [],
        { allowWaiverActions: false },
      );
      resultRendered = true;
      clearError();
    } catch {
      showError("Result failed to load");
    }
  }

  async function refresh() {
    if (refreshing || document.visibilityState === "hidden") {
      return;
    }
    refreshing = true;
    try {
      const evaluationId = new URLSearchParams(window.location.search).get(
        "evaluation_id",
      );
      if (!evaluationId) {
        element("evaluation-detail-loading").hidden = true;
        showError("An evaluation id is required");
        return;
      }
      let response;
      try {
        response = await fetch(
          "/api/v1/evaluations/" + encodeURIComponent(evaluationId),
        );
      } catch {
        element("evaluation-detail-loading").hidden = true;
        showError("Evaluation failed to load");
        return;
      }
      element("evaluation-detail-loading").hidden = true;
      if (!response.ok) {
        showError(await responseMessage(response, "Evaluation failed to load"));
        return;
      }
      let evaluation;
      try {
        evaluation = await response.json();
      } catch {
        showError("Evaluation failed to load");
        return;
      }
      if (
        !monitor.validEvaluation(evaluation) ||
        evaluation.id !== evaluationId
      ) {
        showError("Evaluation failed to load");
        return;
      }
      renderEvaluation(evaluation);
      await loadResult();
    } finally {
      refreshing = false;
    }
  }

  /** @param {"cancel" | "retry"} action */
  async function mutate(action) {
    if (!currentEvaluation) {
      return;
    }
    const control = element("evaluation-detail-" + action);
    control.disabled = true;
    try {
      const response = await monitor.mutate({
        action,
        csrfToken: window.qualityBarOperator.csrfToken(),
        evaluationId: currentEvaluation.id,
      });
      if (!response.ok) {
        showError(await responseMessage(response, "Evaluation action failed"));
        return;
      }
      clearError();
      await refresh();
    } catch {
      showError("Evaluation action failed");
    } finally {
      control.disabled = false;
    }
  }

  function start() {
    element("evaluation-detail-cancel").addEventListener("click", () =>
      mutate("cancel"),
    );
    element("evaluation-detail-retry").addEventListener("click", () =>
      mutate("retry"),
    );
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "hidden") {
        refresh();
      }
    });
    if (typeof window.setInterval === "function") {
      window.setInterval(refresh, 5000);
    }
    refresh();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
