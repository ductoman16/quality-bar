"use strict";

const applicabilityBody = document.getElementById("analytics-applicability");
const criterionBody = document.getElementById("analytics-criteria");
const evaluationOutcomesBody = document.getElementById(
  "analytics-evaluation-outcomes",
);
const findingImpactBody = document.getElementById("analytics-finding-impact");
const waiversBody = document.getElementById("analytics-waivers");
const waiverDecisionsBody = document.getElementById(
  "analytics-waiver-decisions",
);
const reviewRunReliabilityBody = document.getElementById(
  "analytics-review-run-reliability",
);
const waiverAdjudicationReliabilityBody = document.getElementById(
  "analytics-waiver-adjudication-reliability",
);
const executionFailureCodesBody = document.getElementById(
  "analytics-execution-failure-codes",
);
const executionDurationBody = document.getElementById(
  "analytics-execution-duration",
);
const tokenCountersBody = document.getElementById("analytics-token-counters");
const transitionsBody = document.getElementById("analytics-transitions");
const populationStatus = document.getElementById("analytics-population");
const filterForm = document.getElementById("analytics-filters");
const analyticsError = document.getElementById("analytics-error");
const overviewEvaluations = document.getElementById(
  "analytics-overview-evaluations",
);
const overviewClear = document.getElementById("analytics-overview-clear");
const overviewBlocking = document.getElementById("analytics-overview-blocking");
const overviewError = document.getElementById("analytics-overview-error");
const overviewReviewSuccess = document.getElementById(
  "analytics-overview-review-success",
);
const analyticsWindow = /** @type {any} */ (window);
const analyticsContract = analyticsWindow.qualityBarAnalyticsContract;
const analyticsState = analyticsWindow.qualityBarAnalyticsState;
if (!analyticsContract || !analyticsState) {
  throw new Error("analytics_contract_unavailable");
}
if (!filterForm) {
  throw new Error("analytics_filter_surface_missing");
}
const {
  validCount: analyticsValidCount,
  validExecutionReliability: analyticsValidExecutionReliability,
} = analyticsContract;

/** @param {{numerator: number, denominator: number}} rate */
function rateText(rate) {
  if (rate.denominator === 0) {
    return "—";
  }
  return `${rate.numerator}/${rate.denominator}`;
}

/** @param {{numerator: number, denominator: number}} rate */
function percentText(rate) {
  if (rate.denominator === 0) {
    return "—";
  }
  return `${Math.round((rate.numerator / rate.denominator) * 100)}%`;
}

/** @param {HTMLElement | null} target @param {string} value */
function setOverview(target, value) {
  if (target) {
    target.textContent = value;
  }
}

/** @param {number | null} value */
function measurementText(value) {
  return value === null ? "—" : String(value);
}

/** @param {unknown[]} values */
function row(values) {
  const element = document.createElement("tr");
  for (const value of values) {
    const cell = document.createElement("td");
    cell.textContent = String(value);
    element.append(cell);
  }
  return element;
}

/** @param {any} document */
function render(document) {
  if (
    !applicabilityBody ||
    !criterionBody ||
    !evaluationOutcomesBody ||
    !findingImpactBody ||
    !waiversBody ||
    !waiverDecisionsBody ||
    !reviewRunReliabilityBody ||
    !waiverAdjudicationReliabilityBody ||
    !executionFailureCodesBody ||
    !executionDurationBody ||
    !tokenCountersBody ||
    !transitionsBody ||
    !populationStatus ||
    !analyticsError ||
    !Array.isArray(document?.review_applicability) ||
    !Array.isArray(document?.criterion_outcomes) ||
    typeof document?.evaluation_outcomes !== "object" ||
    typeof document?.finding_impact !== "object" ||
    typeof document?.waiver_analytics !== "object" ||
    typeof document?.waiver_analytics?.decision_history !== "object" ||
    typeof document?.population !== "object" ||
    !["no_evaluations", "no_filter_match", "pending_data", "ready"].includes(
      document?.population?.state,
    ) ||
    !analyticsValidCount(document?.population?.total_evaluations) ||
    !analyticsValidCount(document?.population?.matching_evaluations) ||
    !analyticsValidCount(document?.population?.matching_waiver_requests) ||
    !analyticsValidCount(document?.population?.matching_waiver_decisions) ||
    !analyticsValidCount(document?.population?.matching_waiver_adjudications) ||
    !analyticsValidCount(document?.population?.pending_evaluations) ||
    !analyticsValidCount(document?.population?.pending_adjudications) ||
    typeof document?.population?.filters !== "object" ||
    typeof document?.pull_request_criterion_transitions !== "object" ||
    ![
      "triggered_to_clear",
      "no_longer_applicable",
      "triggered_to_error",
      "sample_size",
    ].every((name) =>
      analyticsValidCount(document?.pull_request_criterion_transitions?.[name]),
    ) ||
    !analyticsValidExecutionReliability(document?.review_run_reliability, [
      "successful",
      "failed",
      "operator_cancelled",
      "superseded",
    ]) ||
    !analyticsValidExecutionReliability(
      document?.waiver_adjudication_reliability,
      ["completed", "failed", "cancelled"],
    )
  ) {
    throw new Error("analytics_document_invalid");
  }
  applicabilityBody.replaceChildren();
  criterionBody.replaceChildren();
  evaluationOutcomesBody.replaceChildren();
  findingImpactBody.replaceChildren();
  waiversBody.replaceChildren();
  waiverDecisionsBody.replaceChildren();
  reviewRunReliabilityBody.replaceChildren();
  waiverAdjudicationReliabilityBody.replaceChildren();
  executionFailureCodesBody.replaceChildren();
  executionDurationBody.replaceChildren();
  tokenCountersBody.replaceChildren();
  transitionsBody.replaceChildren();
  const populationLabels = {
    no_evaluations: "No Evaluations",
    no_filter_match: "No filter match",
    pending_data: "Pending data",
    ready: "Ready",
  };
  populationStatus.textContent = `${
    populationLabels[
      /** @type {keyof typeof populationLabels} */ (document.population.state)
    ]
  } · ${document.population.matching_evaluations}/${document.population.total_evaluations} Evaluations`;
  populationStatus.textContent +=
    ` · ${document.population.matching_waiver_requests} Waiver Requests` +
    ` · ${document.population.matching_waiver_decisions} Waiver Decisions` +
    ` · ${document.population.matching_waiver_adjudications} Waiver Adjudications`;
  populationStatus.hidden = false;
  const outcomes = document.evaluation_outcomes;
  setOverview(
    overviewEvaluations,
    String(document.population.matching_evaluations),
  );
  setOverview(overviewClear, percentText(outcomes.clear_rate));
  setOverview(overviewBlocking, percentText(outcomes.blocking_rate));
  setOverview(overviewError, percentText(outcomes.error_rate));
  setOverview(
    overviewReviewSuccess,
    percentText(document.review_run_reliability.successful_rate),
  );
  const transitions = document.pull_request_criterion_transitions;
  transitionsBody.append(
    row([
      transitions.triggered_to_clear,
      transitions.no_longer_applicable,
      transitions.triggered_to_error,
      transitions.sample_size,
    ]),
  );
  const evaluations = document.evaluation_outcomes;
  evaluationOutcomesBody.append(
    row([
      evaluations.clear,
      evaluations.advisory,
      evaluations.blocking,
      evaluations.error,
      evaluations.pending,
      rateText(evaluations.clear_rate),
      rateText(evaluations.advisory_rate),
      rateText(evaluations.blocking_rate),
      rateText(evaluations.error_rate),
    ]),
  );
  for (const item of document.review_applicability) {
    applicabilityBody.append(
      row([
        item.review_id,
        item.applicable,
        item.not_applicable,
        item.error,
        rateText(item.applicability_rate),
        rateText(item.error_rate),
      ]),
    );
  }
  for (const item of document.criterion_outcomes) {
    criterionBody.append(
      row([
        item.criterion_id,
        item.triggered,
        item.clear,
        item.not_applicable,
        item.error,
        rateText(item.trigger_rate),
        rateText(item.clear_rate),
        rateText(item.not_applicable_rate),
        rateText(item.error_rate),
      ]),
    );
  }
  const findings = document.finding_impact;
  findingImpactBody.append(
    row([
      findings.advisory,
      findings.blocking,
      rateText(findings.findings_per_triggered_criterion_result),
    ]),
  );
  const waivers = document.waiver_analytics;
  waiversBody.append(
    row([
      waivers.advisory_findings,
      waivers.requested_findings,
      rateText(waivers.waiver_request_rate),
      waivers.waived_findings,
      rateText(waivers.waived_finding_rate),
    ]),
  );
  const decisions = waivers.decision_history;
  waiverDecisionsBody.append(
    row([
      decisions.accepted,
      decisions.denied,
      decisions.error,
      rateText(decisions.accepted_rate),
      rateText(decisions.denied_rate),
      rateText(decisions.error_rate),
    ]),
  );
  const reviewRuns = document.review_run_reliability;
  reviewRunReliabilityBody.append(
    row([
      reviewRuns.successful,
      reviewRuns.failed,
      reviewRuns.operator_cancelled,
      reviewRuns.superseded,
      reviewRuns.active,
      rateText(reviewRuns.successful_rate),
      rateText(reviewRuns.failed_rate),
      rateText(reviewRuns.operator_cancelled_rate),
      rateText(reviewRuns.superseded_rate),
    ]),
  );
  const adjudications = document.waiver_adjudication_reliability;
  waiverAdjudicationReliabilityBody.append(
    row([
      adjudications.completed,
      adjudications.failed,
      adjudications.cancelled,
      adjudications.active,
      rateText(adjudications.completed_rate),
      rateText(adjudications.failed_rate),
      rateText(adjudications.cancelled_rate),
    ]),
  );
  for (const [kind, reliability] of [
    ["Review Run", reviewRuns],
    ["Waiver Adjudication", adjudications],
  ]) {
    for (const failure of reliability.failure_codes) {
      executionFailureCodesBody.append(
        row([kind, failure.code, failure.count]),
      );
    }
  }
  for (const [kind, reliability, outcomes] of [
    [
      "Review Run",
      reviewRuns,
      [
        ["terminal", "Terminal"],
        ["successful", "Successful"],
        ["failed", "Failed"],
        ["operator_cancelled", "Operator-cancelled"],
        ["superseded", "Superseded"],
      ],
    ],
    [
      "Waiver Adjudication",
      adjudications,
      [
        ["terminal", "Terminal"],
        ["completed", "Completed"],
        ["failed", "Failed"],
        ["cancelled", "Cancelled"],
      ],
    ],
  ]) {
    for (const [outcome, label] of outcomes) {
      const duration = reliability.duration[outcome];
      executionDurationBody.append(
        row([
          kind,
          label,
          duration.execution_count,
          measurementText(duration.total_ms),
          measurementText(duration.median_ms),
        ]),
      );
    }
  }
  for (const [kind, reliability] of [
    ["Review Run", reviewRuns],
    ["Waiver Adjudication", adjudications],
  ]) {
    for (const [counter, label] of [
      ["input_tokens", "Input tokens"],
      ["cached_input_tokens", "Cached input tokens"],
      ["output_tokens", "Output tokens"],
    ]) {
      const summary = reliability.token_counters[counter];
      tokenCountersBody.append(
        row([
          kind,
          label,
          measurementText(summary.sum),
          measurementText(summary.median),
          rateText(summary.coverage),
        ]),
      );
    }
  }
  analyticsError.hidden = true;
  analyticsError.textContent = "";
}

/** @param {Error} error */
function showQueryFailure(error) {
  if (!analyticsError) {
    throw new Error("analytics_error_surface_missing", { cause: error });
  }
  analyticsState.clear();
  for (const target of [
    overviewEvaluations,
    overviewClear,
    overviewBlocking,
    overviewError,
    overviewReviewSuccess,
  ]) {
    setOverview(target, "—");
  }
  analyticsError.hidden = false;
  analyticsError.textContent = error.message;
}

analyticsWindow.qualityBarAnalytics = {
  render,
  showQueryFailure,
};

/** @param {string} query */
function load(query) {
  return analyticsWindow
    .fetch(`/api/v1/analytics${query}`)
    .then(async (/** @type {Response} */ response) => {
      const body = await response.json();
      if (!response.ok) {
        throw new Error(`${body.error.code}: ${body.error.message}`);
      }
      render(body);
    })
    .catch((/** @type {Error} */ error) => {
      showQueryFailure(error);
    });
}

filterForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (typeof analyticsWindow.fetch !== "function") {
    throw new Error("analytics_fetch_unavailable");
  }
  const parameters = new URLSearchParams();
  for (const [name, value] of new FormData(
    /** @type {HTMLFormElement} */ (filterForm),
  )) {
    if (typeof value === "string" && value !== "") {
      parameters.set(name, value);
    }
  }
  const query = parameters.size === 0 ? "" : `?${parameters}`;
  void load(query);
});

if (typeof analyticsWindow.fetch === "function") {
  void load("");
}
