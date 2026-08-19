import assert from "node:assert/strict";
import { test } from "node:test";

import { createAnalyticsService } from "../src/analytics.js";
import { nearestRankP95 } from "../src/execution-analytics.js";
test("Analytics derives current Evaluation, Finding, and waiver populations from immutable facts", () => {
  const analytics = createAnalyticsService({
    all(sql) {
      if (sql.includes("AS analytics_transition_rows")) {
        return [];
      }
      if (sql.includes("AS analytics_filter_rows")) {
        return [];
      }
      if (sql.includes("FROM applicability_results")) {
        return [];
      }
      if (sql.includes("AS analytics_criterion_rows")) {
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
            analytics_evaluation_id: "evaluation-1",
            blocking_finding_count: 0,
            created_at: 0,
            current_waiver_error_count: 0,
            execution_status: "completed",
            result_outcome: "advisory",
            unwaived_advisory_finding_count: 0,
          },
          {
            active_waiver_adjudication_count: 0,
            analytics_evaluation_id: "evaluation-2",
            blocking_finding_count: 0,
            created_at: 0,
            current_waiver_error_count: 0,
            execution_status: "completed",
            result_outcome: "advisory",
            unwaived_advisory_finding_count: 1,
          },
          {
            active_waiver_adjudication_count: 0,
            analytics_evaluation_id: "evaluation-3",
            blocking_finding_count: 1,
            created_at: 0,
            current_waiver_error_count: 0,
            execution_status: "completed",
            result_outcome: "blocking",
            unwaived_advisory_finding_count: 0,
          },
          {
            active_waiver_adjudication_count: 0,
            analytics_evaluation_id: "evaluation-4",
            blocking_finding_count: 0,
            created_at: 0,
            current_waiver_error_count: 0,
            execution_status: "completed",
            result_outcome: "error",
            unwaived_advisory_finding_count: 0,
          },
          {
            active_waiver_adjudication_count: 0,
            analytics_evaluation_id: "evaluation-5",
            blocking_finding_count: 0,
            created_at: 0,
            current_waiver_error_count: 1,
            execution_status: "completed",
            result_outcome: "advisory",
            unwaived_advisory_finding_count: 1,
          },
          {
            active_waiver_adjudication_count: 1,
            analytics_evaluation_id: "evaluation-6",
            blocking_finding_count: 0,
            created_at: 0,
            current_waiver_error_count: 0,
            execution_status: "completed",
            result_outcome: "advisory",
            unwaived_advisory_finding_count: 1,
          },
          {
            active_waiver_adjudication_count: 0,
            analytics_evaluation_id: "evaluation-7",
            blocking_finding_count: 0,
            created_at: 0,
            current_waiver_error_count: 0,
            execution_status: "queued",
            result_outcome: null,
            unwaived_advisory_finding_count: 0,
          },
          {
            active_waiver_adjudication_count: 0,
            analytics_evaluation_id: "evaluation-8",
            blocking_finding_count: 0,
            created_at: 0,
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
      if (sql.includes("AS analytics_decision_rows")) {
        return [
          { outcome: "accepted" },
          { outcome: "denied" },
          { outcome: "error" },
          { outcome: "error" },
        ];
      }
      if (
        sql.includes("SELECT waiver_requests.id AS waiver_request_id") ||
        sql.includes("AS analytics_adjudication_scope_rows") ||
        sql.includes("AS analytics_review_run_rows") ||
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
    evaluation_overview: evaluationOverview,
    matching_facts: matchingFacts,
    review_run_reliability: reviewRunReliability,
    waiver_adjudication_reliability: waiverAdjudicationReliability,
    ...document
  } = analytics.read();
  assert.equal(matchingFacts.evaluations.length, 8);
  assert.deepEqual(
    {
      clear_count: evaluationOverview.clear_count,
      duration_sample_count: evaluationOverview.duration_sample_count,
      p95_duration_ms: evaluationOverview.p95_duration_ms,
      clear_rate: evaluationOverview.clear_rate,
      terminal_count: evaluationOverview.terminal_count,
      window_start: evaluationOverview.window.start,
    },
    {
      clear_count: 1,
      duration_sample_count: 0,
      p95_duration_ms: null,
      clear_rate: { denominator: 7, numerator: 1 },
      terminal_count: 7,
      window_start: 0,
    },
  );
  assert.ok(Number.isSafeInteger(evaluationOverview.window.end));
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
    daily_trend: [
      {
        advisory: 1,
        blocking: 1,
        clear: 1,
        date: "1970-01-01",
        error: 3,
        evaluations: 8,
        pending: 2,
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
    population: {
      filters: {},
      matching_evaluations: 8,
      matching_waiver_adjudications: 0,
      matching_waiver_decisions: 4,
      matching_waiver_requests: 0,
      pending_adjudications: 0,
      pending_evaluations: 2,
      state: "pending_data",
      total_evaluations: 8,
    },
    pull_request_criterion_transitions: {
      no_longer_applicable: 0,
      sample_size: 0,
      triggered_to_clear: 0,
      triggered_to_error: 0,
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

test("Evaluation overview uses the fleet-wide half-open window", () => {
  const rows = [
    overviewRow("completed", "clear", 100, 110),
    overviewRow("completed", "clear", 120, 140),
    overviewRow("completed", "advisory", 150, 180),
    overviewRow("failed", null, 170, 190),
    overviewRow("cancelled", null, 190, null),
  ];
  /** @type {unknown[]} */
  let parameters = [];
  const analytics = createAnalyticsService({
    all(sql, ...queryParameters) {
      if (sql.includes("AS effective_outcome_source")) {
        parameters = queryParameters;
        return rows;
      }
      return [];
    },
  });

  assert.deepEqual(
    analytics.read({
      end: 200,
      repository_id: "repository-not-in-filtered-facts",
      start: 100,
    }).evaluation_overview,
    {
      clear_count: 3,
      duration_sample_count: 3,
      p95_duration_ms: 30,
      clear_rate: { denominator: 5, numerator: 3 },
      terminal_count: 5,
      window: { end: 200, start: 100 },
    },
  );
  assert.deepEqual(parameters, [100, 200]);
});

test("Evaluation overview rejects negative durations", () => {
  const analytics = createAnalyticsService({
    all(sql) {
      return sql.includes("AS effective_outcome_source")
        ? [overviewRow("completed", "clear", 20, 19)]
        : [];
    },
  });
  assert.throws(() => analytics.read({ end: 100, start: 0 }), {
    code: "analytics_fact_invalid",
  });
});

test("nearestRankP95 handles empty and boundary samples", () => {
  assert.equal(nearestRankP95([]), null);
  assert.equal(nearestRankP95([7]), 7);
  assert.equal(nearestRankP95([9, 3]), 9);
  assert.equal(
    nearestRankP95([
      100, 1, 6, 5, 4, 3, 2, 8, 7, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
    ]),
    19,
  );
});

/**
 * @param {"cancelled" | "completed" | "failed"} executionStatus
 * @param {"advisory" | "clear" | null} resultOutcome
 * @param {number} createdAt
 * @param {number | null} completedAt
 */
function overviewRow(executionStatus, resultOutcome, createdAt, completedAt) {
  return {
    active_waiver_adjudication_count: 0,
    blocking_finding_count: 0,
    completed_at: completedAt,
    created_at: createdAt,
    current_waiver_error_count: 0,
    execution_status: executionStatus,
    result_outcome: resultOutcome,
    unwaived_advisory_finding_count: 0,
  };
}
