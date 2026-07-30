"use strict";

const evaluationSurface = document.getElementById(
  "analytics-matching-evaluations",
);
const reviewRunSurface = document.getElementById(
  "analytics-matching-review-runs",
);
if (!evaluationSurface || !reviewRunSurface) {
  throw new Error("analytics_matching_facts_surface_missing");
}
const matchingEvaluationsBody = evaluationSurface;
const matchingReviewRunsBody = reviewRunSurface;

/** @param {unknown[]} values */
function matchingRow(values) {
  const element = document.createElement("tr");
  for (const value of values) {
    const cell = document.createElement("td");
    cell.textContent = String(value);
    element.append(cell);
  }
  return element;
}

/** @param {number | null} value */
function measurement(value) {
  return value === null ? "Unavailable" : String(value);
}

/** @param {any} facts */
function renderMatchingFacts(facts) {
  matchingEvaluationsBody.replaceChildren();
  matchingReviewRunsBody.replaceChildren();
  for (const fact of facts.evaluations) {
    matchingEvaluationsBody.append(
      matchingRow([
        fact.evaluation_id,
        fact.repository_id,
        fact.pull_request_number ?? "None",
        fact.terminal_outcome,
        fact.created_at,
      ]),
    );
  }
  for (const fact of facts.review_runs) {
    const duration =
      fact.started_at === null || fact.completed_at === null
        ? "Unavailable"
        : fact.completed_at - fact.started_at;
    matchingReviewRunsBody.append(
      matchingRow([
        fact.review_run_id,
        fact.repository_id,
        `${fact.base_commit}..${fact.head_commit}`,
        fact.pull_request_number ?? "None",
        fact.evaluation_id,
        fact.review_id,
        fact.review_version_id,
        [fact.model, fact.reasoning_effort, fact.service_tier].join(" · "),
        fact.execution_status,
        fact.cancellation_code ?? "None",
        fact.criterion_results
          .map(
            (/** @type {any} */ item) =>
              `${item.criterion_id}: ${item.outcome}`,
          )
          .join(", "),
        fact.findings
          .map(
            (/** @type {any} */ item) =>
              `${item.finding_id}: ${item.criterion_id}/${item.impact}`,
          )
          .join(", "),
        fact.waiver_requests
          .map(
            (/** @type {any} */ item) =>
              `${item.waiver_request_id}: ${item.finding_id}@${item.created_at}`,
          )
          .join(", "),
        fact.waiver_decisions
          .map(
            (/** @type {any} */ item) =>
              `${item.waiver_decision_id}: ${item.outcome}@${item.created_at}`,
          )
          .join(", "),
        duration,
        [fact.input_tokens, fact.cached_input_tokens, fact.output_tokens]
          .map(measurement)
          .join(" / "),
        fact.error_code ?? "None",
      ]),
    );
  }
}

function clearMatchingFacts() {
  matchingEvaluationsBody.replaceChildren();
  matchingReviewRunsBody.replaceChildren();
}

const analyticsMatchingFactsWindow = /** @type {any} */ (window);
analyticsMatchingFactsWindow.qualityBarAnalyticsMatchingFacts = {
  clear: clearMatchingFacts,
  render: renderMatchingFacts,
};
