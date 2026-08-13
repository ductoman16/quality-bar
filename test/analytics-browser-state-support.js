import assert from "node:assert/strict";

/** @param {any} input */
export function assertAnalyticsBrowserStates(input) {
  const {
    analyticsDocument,
    context,
    error,
    evaluationOutcomes,
    page,
    population,
  } = input;
  assert.ok(
    page.indexOf('id="analytics-transitions"') <
      page.indexOf('<script src="/assets/analytics.js">'),
  );
  const renderedEvaluation = evaluationOutcomes.options[0];
  assert.throws(
    () =>
      context.window.qualityBarAnalytics.render({
        ...analyticsDocument,
        review_run_reliability: {
          ...analyticsDocument.review_run_reliability,
          duration: null,
          token_counters: null,
        },
      }),
    { message: "analytics_document_invalid" },
  );
  assert.equal(evaluationOutcomes.options[0], renderedEvaluation);
  assert.throws(
    () =>
      context.window.qualityBarAnalytics.render({
        ...analyticsDocument,
        review_run_reliability: {
          ...analyticsDocument.review_run_reliability,
          token_counters: null,
        },
      }),
    { message: "analytics_document_invalid" },
  );
  assert.equal(evaluationOutcomes.options[0], renderedEvaluation);
  assert.equal(error.hidden, true);
  context.window.qualityBarAnalytics.render({
    ...analyticsDocument,
    population: {
      filters: {},
      matching_evaluations: 0,
      matching_waiver_adjudications: 0,
      matching_waiver_decisions: 0,
      matching_waiver_requests: 0,
      pending_adjudications: 0,
      pending_evaluations: 0,
      state: "no_evaluations",
      total_evaluations: 0,
    },
  });
  assert.equal(
    population.textContent,
    "No Evaluations · 0/0 Evaluations · 0 Waiver Requests · 0 Waiver Decisions · 0 Waiver Adjudications",
  );
  context.window.qualityBarAnalytics.render({
    ...analyticsDocument,
    evaluation_outcomes: {
      ...analyticsDocument.evaluation_outcomes,
      advisory_rate: { denominator: 0, numerator: 0 },
      blocking_rate: { denominator: 0, numerator: 0 },
      clear_rate: { denominator: 0, numerator: 0 },
      error_rate: { denominator: 0, numerator: 0 },
    },
    population: {
      filters: { repository_id: "repository-missing" },
      matching_evaluations: 0,
      matching_waiver_adjudications: 0,
      matching_waiver_decisions: 0,
      matching_waiver_requests: 0,
      pending_adjudications: 0,
      pending_evaluations: 0,
      state: "no_filter_match",
      total_evaluations: 11,
    },
  });
  assert.equal(
    population.textContent,
    "No filter match · 0/11 Evaluations · 0 Waiver Requests · 0 Waiver Decisions · 0 Waiver Adjudications",
  );
  context.window.qualityBarAnalytics.showQueryFailure(
    new Error("analytics_query_failed: Analytics query failed"),
  );
  assert.equal(population.hidden, true);
  assert.equal(evaluationOutcomes.options.length, 0);
  assert.equal(error.hidden, false);
  assert.equal(
    error.textContent,
    "analytics_query_failed: Analytics query failed",
  );
}
