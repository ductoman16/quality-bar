import assert from "node:assert/strict";
import { test } from "node:test";

import { createAnalyticsService } from "../src/analytics.js";

test("Analytics derives honest Review applicability and stable Criterion rates", () => {
  const queries = [];
  const analytics = createAnalyticsService({
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
      if (sql.includes("FROM criterion_results")) {
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
  });

  const {
    review_run_reliability: reviewRunReliability,
    waiver_adjudication_reliability: waiverAdjudicationReliability,
    ...document
  } = analytics.read();
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
  assert.equal(queries.length, 8);
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

test("Analytics derives current Evaluation, Finding, and waiver populations from immutable facts", () => {
  const analytics = createAnalyticsService({
    all(sql) {
      if (sql.includes("FROM applicability_results")) {
        return [];
      }
      if (sql.includes("FROM criterion_results")) {
        return [
          { criterion_id: "criterion-1", outcome: "triggered" },
          { criterion_id: "criterion-2", outcome: "triggered" },
          { criterion_id: "criterion-3", outcome: "clear" },
        ];
      }
      if (sql.includes("FROM evaluations")) {
        return [
          {
            active_waiver_adjudication_count: 0,
            blocking_finding_count: 0,
            current_waiver_error_count: 0,
            execution_status: "completed",
            result_outcome: "advisory",
            unwaived_advisory_finding_count: 0,
          },
          {
            active_waiver_adjudication_count: 0,
            blocking_finding_count: 0,
            current_waiver_error_count: 0,
            execution_status: "completed",
            result_outcome: "advisory",
            unwaived_advisory_finding_count: 1,
          },
          {
            active_waiver_adjudication_count: 0,
            blocking_finding_count: 1,
            current_waiver_error_count: 0,
            execution_status: "completed",
            result_outcome: "blocking",
            unwaived_advisory_finding_count: 0,
          },
          {
            active_waiver_adjudication_count: 0,
            blocking_finding_count: 0,
            current_waiver_error_count: 0,
            execution_status: "completed",
            result_outcome: "error",
            unwaived_advisory_finding_count: 0,
          },
          {
            active_waiver_adjudication_count: 0,
            blocking_finding_count: 0,
            current_waiver_error_count: 1,
            execution_status: "completed",
            result_outcome: "advisory",
            unwaived_advisory_finding_count: 1,
          },
          {
            active_waiver_adjudication_count: 1,
            blocking_finding_count: 0,
            current_waiver_error_count: 0,
            execution_status: "completed",
            result_outcome: "advisory",
            unwaived_advisory_finding_count: 1,
          },
          {
            active_waiver_adjudication_count: 0,
            blocking_finding_count: 0,
            current_waiver_error_count: 0,
            execution_status: "queued",
            result_outcome: null,
            unwaived_advisory_finding_count: 0,
          },
          {
            active_waiver_adjudication_count: 0,
            blocking_finding_count: 0,
            current_waiver_error_count: 0,
            execution_status: "failed",
            result_outcome: null,
            unwaived_advisory_finding_count: 0,
          },
        ];
      }
      if (sql.includes("AS finding_impact")) {
        return [
          { finding_impact: "advisory" },
          { finding_impact: "advisory" },
          { finding_impact: "blocking" },
        ];
      }
      if (sql.includes("AS has_waiver_request")) {
        return [
          { has_accepted_decision: 1, has_waiver_request: 1 },
          { has_accepted_decision: 0, has_waiver_request: 0 },
        ];
      }
      if (sql.includes("FROM waiver_decisions")) {
        return [
          { outcome: "accepted" },
          { outcome: "denied" },
          { outcome: "error" },
          { outcome: "error" },
        ];
      }
      if (
        sql.includes("FROM review_runs AS analytics_review_runs") ||
        sql.includes(
          "FROM waiver_adjudications AS analytics_waiver_adjudications",
        )
      ) {
        return [];
      }
      throw new Error("Unexpected analytics query");
    },
  });

  const {
    review_run_reliability: reviewRunReliability,
    waiver_adjudication_reliability: waiverAdjudicationReliability,
    ...document
  } = analytics.read();
  assert.equal(reviewRunReliability.active, 0);
  assert.equal(waiverAdjudicationReliability.active, 0);
  assert.deepEqual(document, {
    criterion_outcomes: [
      {
        clear: 0,
        clear_rate: { denominator: 1, numerator: 0 },
        criterion_id: "criterion-1",
        error: 0,
        error_rate: { denominator: 1, numerator: 0 },
        not_applicable: 0,
        not_applicable_rate: { denominator: 1, numerator: 0 },
        trigger_rate: { denominator: 1, numerator: 1 },
        triggered: 1,
      },
      {
        clear: 0,
        clear_rate: { denominator: 1, numerator: 0 },
        criterion_id: "criterion-2",
        error: 0,
        error_rate: { denominator: 1, numerator: 0 },
        not_applicable: 0,
        not_applicable_rate: { denominator: 1, numerator: 0 },
        trigger_rate: { denominator: 1, numerator: 1 },
        triggered: 1,
      },
      {
        clear: 1,
        clear_rate: { denominator: 1, numerator: 1 },
        criterion_id: "criterion-3",
        error: 0,
        error_rate: { denominator: 1, numerator: 0 },
        not_applicable: 0,
        not_applicable_rate: { denominator: 1, numerator: 0 },
        trigger_rate: { denominator: 1, numerator: 0 },
        triggered: 0,
      },
    ],
    evaluation_outcomes: {
      advisory: 1,
      advisory_rate: { denominator: 6, numerator: 1 },
      blocking: 1,
      blocking_rate: { denominator: 6, numerator: 1 },
      clear: 1,
      clear_rate: { denominator: 6, numerator: 1 },
      error: 3,
      error_rate: { denominator: 6, numerator: 3 },
      pending: 2,
    },
    finding_impact: {
      advisory: 2,
      blocking: 1,
      findings_per_triggered_criterion_result: {
        denominator: 2,
        numerator: 3,
      },
    },
    review_applicability: [],
    waiver_analytics: {
      advisory_findings: 2,
      decision_history: {
        accepted: 1,
        accepted_rate: { denominator: 4, numerator: 1 },
        denied: 1,
        denied_rate: { denominator: 4, numerator: 1 },
        error: 2,
        error_rate: { denominator: 4, numerator: 2 },
      },
      requested_findings: 1,
      waived_findings: 1,
      waived_finding_rate: { denominator: 2, numerator: 1 },
      waiver_request_rate: { denominator: 2, numerator: 1 },
    },
  });
});
