"use strict";

const analyticsBodyIds = [
  "analytics-applicability",
  "analytics-criteria",
  "analytics-evaluation-outcomes",
  "analytics-finding-impact",
  "analytics-waivers",
  "analytics-waiver-decisions",
  "analytics-review-run-reliability",
  "analytics-waiver-adjudication-reliability",
  "analytics-execution-failure-codes",
  "analytics-execution-duration",
  "analytics-token-counters",
  "analytics-transitions",
];

function clearAnalyticsState() {
  for (const id of analyticsBodyIds) {
    document.getElementById(id)?.replaceChildren();
  }
  const population = document.getElementById("analytics-population");
  if (population) {
    population.hidden = true;
    population.textContent = "";
  }
  for (const id of [
    "analytics-invalid-denominator",
    "analytics-unavailable-tokens",
  ]) {
    const status = document.getElementById(id);
    if (status) {
      status.hidden = true;
    }
  }
  const matchingFacts = /** @type {any} */ (window)
    .qualityBarAnalyticsMatchingFacts;
  if (!matchingFacts) {
    throw new Error("analytics_matching_facts_unavailable");
  }
  matchingFacts.clear();
}

const analyticsStateWindow = /** @type {any} */ (window);
analyticsStateWindow.qualityBarAnalyticsState = {
  clear: clearAnalyticsState,
};
