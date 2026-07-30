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
const analyticsError = document.getElementById("analytics-error");

/** @param {{numerator: number, denominator: number}} rate */
function rateText(rate) {
  return `${rate.numerator}/${rate.denominator}`;
}

/** @param {number | null} value */
function measurementText(value) {
  return value === null ? "Unavailable" : String(value);
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
    !analyticsError ||
    !Array.isArray(document?.review_applicability) ||
    !Array.isArray(document?.criterion_outcomes) ||
    typeof document?.evaluation_outcomes !== "object" ||
    typeof document?.finding_impact !== "object" ||
    typeof document?.review_run_reliability !== "object" ||
    typeof document?.waiver_analytics !== "object" ||
    typeof document?.waiver_analytics?.decision_history !== "object" ||
    typeof document?.waiver_adjudication_reliability !== "object" ||
    !Array.isArray(document?.review_run_reliability?.failure_codes) ||
    !Array.isArray(document?.waiver_adjudication_reliability?.failure_codes)
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
      reviewRuns.active,
      rateText(reviewRuns.successful_rate),
      rateText(reviewRuns.failed_rate),
      rateText(reviewRuns.operator_cancelled_rate),
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

const browserWindow = /** @type {any} */ (window);
browserWindow.qualityBarAnalytics = { render };

if (typeof browserWindow.fetch === "function") {
  browserWindow
    .fetch("/api/v1/analytics")
    .then(async (/** @type {Response} */ response) => {
      const body = await response.json();
      if (!response.ok) {
        throw new Error(`${body.error.code}: ${body.error.message}`);
      }
      render(body);
    })
    .catch((/** @type {Error} */ error) => {
      if (!analyticsError) {
        throw new Error("analytics_error_surface_missing", { cause: error });
      }
      analyticsError.hidden = false;
      analyticsError.textContent = error.message;
    });
}
