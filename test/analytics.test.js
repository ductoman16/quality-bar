import assert from "node:assert/strict";
import { test } from "node:test";

import { createAnalyticsService } from "../src/analytics.js";

test("Analytics derives honest Review applicability and stable Criterion rates", () => {
  const queries = [];
  const analytics = createAnalyticsService(
    {
      all(sql) {
        queries.push(sql);
        if (sql.includes("applicability_results")) {
          return [
            { outcome: "applicable", review_id: "review-1" },
            { outcome: "applicable", review_id: "review-1" },
            { outcome: "not_applicable", review_id: "review-1" },
            { outcome: "error", review_id: "review-1" },
            { outcome: "error", review_id: "review-2" },
          ];
        }
        if (sql.includes("AS analytics_criterion_rows")) {
          return [
            { criterion_id: "criterion-1", outcome: "triggered" },
            { criterion_id: "criterion-1", outcome: "clear" },
            { criterion_id: "criterion-1", outcome: "not_applicable" },
            { criterion_id: "criterion-1", outcome: "error" },
            { criterion_id: "criterion-2", outcome: "not_applicable" },
          ];
        }
        return [];
      },
    },
    { now: () => 100 },
  );

  const {
    evaluation_overview: evaluationOverview,
    matching_facts: matchingFacts,
    review_run_reliability: reviewRunReliability,
    waiver_adjudication_reliability: waiverAdjudicationReliability,
    ...document
  } = analytics.read();
  assert.deepEqual(matchingFacts, { evaluations: [], review_runs: [] });
  assert.deepEqual(evaluationOverview, {
    clear_count: 0,
    duration_sample_count: 0,
    p95_duration_ms: null,
    clear_rate: { denominator: 0, numerator: 0 },
    terminal_count: 0,
    window: { end: 100, start: 0 },
  });
  assert.deepEqual(document, {
    criterion_outcomes: [
      {
        clear: 1,
        clear_rate: { denominator: 2, numerator: 1 },
        criterion_id: "criterion-1",
        error: 1,
        error_rate: { denominator: 4, numerator: 1 },
        not_applicable: 1,
        not_applicable_rate: { denominator: 4, numerator: 1 },
        trigger_rate: { denominator: 2, numerator: 1 },
        triggered: 1,
      },
      {
        clear: 0,
        clear_rate: { denominator: 0, numerator: 0 },
        criterion_id: "criterion-2",
        error: 0,
        error_rate: { denominator: 1, numerator: 0 },
        not_applicable: 1,
        not_applicable_rate: { denominator: 1, numerator: 1 },
        trigger_rate: { denominator: 0, numerator: 0 },
        triggered: 0,
      },
    ],
    evaluation_outcomes: {
      advisory: 0,
      advisory_rate: { denominator: 0, numerator: 0 },
      blocking: 0,
      blocking_rate: { denominator: 0, numerator: 0 },
      clear: 0,
      clear_rate: { denominator: 0, numerator: 0 },
      error: 0,
      error_rate: { denominator: 0, numerator: 0 },
      pending: 0,
    },
    finding_impact: {
      advisory: 0,
      blocking: 0,
      findings_per_triggered_criterion_result: {
        denominator: 1,
        numerator: 0,
      },
    },
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
    pull_request_criterion_transitions: {
      no_longer_applicable: 0,
      sample_size: 0,
      triggered_to_clear: 0,
      triggered_to_error: 0,
    },
    review_applicability: [
      {
        applicable: 2,
        applicability_rate: { denominator: 3, numerator: 2 },
        error: 1,
        error_rate: { denominator: 4, numerator: 1 },
        not_applicable: 1,
        review_id: "review-1",
      },
      {
        applicable: 0,
        applicability_rate: { denominator: 0, numerator: 0 },
        error: 1,
        error_rate: { denominator: 1, numerator: 1 },
        not_applicable: 0,
        review_id: "review-2",
      },
    ],
    waiver_analytics: {
      advisory_findings: 0,
      decision_history: {
        accepted: 0,
        accepted_rate: { denominator: 0, numerator: 0 },
        denied: 0,
        denied_rate: { denominator: 0, numerator: 0 },
        error: 0,
        error_rate: { denominator: 0, numerator: 0 },
      },
      requested_findings: 0,
      waived_findings: 0,
      waived_finding_rate: { denominator: 0, numerator: 0 },
      waiver_request_rate: { denominator: 0, numerator: 0 },
    },
  });
  assert.equal(reviewRunReliability.active, 0);
  assert.deepEqual(reviewRunReliability.duration.terminal, {
    execution_count: 0,
    median_ms: null,
    total_ms: null,
  });
  assert.equal(reviewRunReliability.token_counters.input_tokens.sum, null);
  assert.equal(waiverAdjudicationReliability.active, 0);
  assert.equal(queries.length, 13);
});

test("Analytics query failure surfaces one exact owning error without a partial result", () => {
  const cause = new Error("database interrupted");
  const analytics = createAnalyticsService({
    all() {
      throw cause;
    },
  });

  assert.throws(
    () => analytics.read(),
    (error) => {
      const failure = /** @type {Error & {code?: string}} */ (error);
      return (
        failure.code === "analytics_query_failed" &&
        failure.message === "Analytics query failed" &&
        failure.cause === cause
      );
    },
  );

  const invalidFact = createAnalyticsService({
    all(sql) {
      return sql.includes("FROM evaluations")
        ? [
            {
              active_waiver_adjudication_count: 0,
              blocking_finding_count: 0,
              current_waiver_error_count: 0,
              execution_status: "completed",
              result_outcome: "unsupported",
              unwaived_advisory_finding_count: 0,
            },
          ]
        : [];
    },
  });
  assert.throws(() => invalidFact.read(), {
    code: "analytics_fact_invalid",
    message: "Canonical analytics fact is invalid",
  });
});
