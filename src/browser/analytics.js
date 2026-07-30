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
const analyticsError = document.getElementById("analytics-error");

/** @param {{numerator: number, denominator: number}} rate */
function rateText(rate) {
  return `${rate.numerator}/${rate.denominator}`;
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
    !analyticsError ||
    !Array.isArray(document?.review_applicability) ||
    !Array.isArray(document?.criterion_outcomes) ||
    typeof document?.evaluation_outcomes !== "object" ||
    typeof document?.finding_impact !== "object" ||
    typeof document?.waiver_analytics !== "object" ||
    typeof document?.waiver_analytics?.decision_history !== "object"
  ) {
    throw new Error("analytics_document_invalid");
  }
  applicabilityBody.replaceChildren();
  criterionBody.replaceChildren();
  evaluationOutcomesBody.replaceChildren();
  findingImpactBody.replaceChildren();
  waiversBody.replaceChildren();
  waiverDecisionsBody.replaceChildren();
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
