import assert from "node:assert/strict";

export function analyticsMatchingFactsFixture() {
  return {
    evaluations: [
      {
        base_commit: "a".repeat(40),
        created_at: 100,
        evaluation_id: "evaluation-1",
        head_commit: "b".repeat(40),
        pull_request_number: 42,
        repository_id: "repository-1",
        terminal_outcome: "clear",
      },
    ],
    review_runs: [
      {
        base_commit: "a".repeat(40),
        cached_input_tokens: null,
        cancellation_code: null,
        completed_at: 220,
        created_at: 100,
        criterion_results: [
          { criterion_id: "criterion-1", outcome: "triggered" },
        ],
        error_code: null,
        evaluation_id: "evaluation-1",
        execution_status: "completed",
        findings: [
          {
            criterion_id: "criterion-1",
            finding_id: "finding-1",
            impact: "advisory",
          },
        ],
        head_commit: "b".repeat(40),
        input_tokens: 30,
        model: "gpt-5.4",
        output_tokens: 8,
        pull_request_number: 42,
        reasoning_effort: "high",
        repository_id: "repository-1",
        review_id: "review-1",
        review_run_id: "review-run-1",
        review_version_id: "review-version-1",
        service_tier: "standard",
        started_at: 120,
        waiver_decisions: [
          {
            created_at: 180,
            outcome: "accepted",
            waiver_decision_id: "waiver-decision-1",
            waiver_request_id: "waiver-request-1",
          },
        ],
        waiver_requests: [
          {
            created_at: 160,
            finding_id: "finding-1",
            waiver_request_id: "waiver-request-1",
          },
        ],
      },
    ],
  };
}

/** @param {any} input */
export function assertAnalyticsBrowserStates(input) {
  const {
    analyticsDocument,
    context,
    error,
    evaluationOutcomes,
    invalidDenominator,
    matchingEvaluations,
    page,
    population,
  } = input;
  assert.ok(
    page.indexOf('id="analytics-matching-review-runs"') <
      page.indexOf('<script src="/assets/analytics-matching-facts.js">'),
  );
  const renderedEvaluation = evaluationOutcomes.options[0];
  assert.throws(
    () =>
      context.window.qualityBarAnalytics.render({
        ...analyticsDocument,
        matching_facts: {
          ...analyticsDocument.matching_facts,
          review_runs: [
            {
              ...analyticsDocument.matching_facts.review_runs[0],
              model: undefined,
            },
          ],
        },
      }),
    { message: "analytics_document_invalid" },
  );
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
  assert.equal(invalidDenominator.hidden, false);
  context.window.qualityBarAnalytics.showQueryFailure(
    new Error("analytics_query_failed: Analytics query failed"),
  );
  assert.equal(population.hidden, true);
  assert.equal(evaluationOutcomes.options.length, 0);
  assert.equal(matchingEvaluations.options.length, 0);
  assert.equal(error.hidden, false);
  assert.equal(
    error.textContent,
    "analytics_query_failed: Analytics query failed",
  );
}
