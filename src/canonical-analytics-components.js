import { closedObject } from "./canonical-schema.js";

const count = { minimum: 0, type: "integer" };
const rate = closedObject({ denominator: count, numerator: count }, [
  "numerator",
  "denominator",
]);
const nullableCount = {
  oneOf: [count, { type: "null" }],
};
const nullableMeasurement = {
  oneOf: [{ minimum: 0, type: "number" }, { type: "null" }],
};
const durationSummary = closedObject(
  {
    execution_count: count,
    median_ms: nullableMeasurement,
    total_ms: nullableCount,
  },
  ["execution_count", "median_ms", "total_ms"],
);
const tokenCounters = closedObject(
  {
    cached_input_tokens: {
      $ref: "#/components/schemas/TokenCounterAnalytics",
    },
    input_tokens: { $ref: "#/components/schemas/TokenCounterAnalytics" },
    output_tokens: { $ref: "#/components/schemas/TokenCounterAnalytics" },
  },
  ["input_tokens", "cached_input_tokens", "output_tokens"],
);
const failureCodes = {
  items: { $ref: "#/components/schemas/ExecutionFailureCodeAnalytics" },
  type: "array",
};

export function canonicalAnalyticsSchemas() {
  return {
    Analytics: closedObject(
      {
        criterion_outcomes: {
          items: { $ref: "#/components/schemas/CriterionOutcomeAnalytics" },
          type: "array",
        },
        evaluation_outcomes: {
          $ref: "#/components/schemas/EvaluationOutcomeAnalytics",
        },
        finding_impact: {
          $ref: "#/components/schemas/FindingImpactAnalytics",
        },
        review_applicability: {
          items: { $ref: "#/components/schemas/ReviewApplicabilityAnalytics" },
          type: "array",
        },
        review_run_reliability: {
          $ref: "#/components/schemas/ReviewRunReliabilityAnalytics",
        },
        waiver_analytics: {
          $ref: "#/components/schemas/WaiverAnalytics",
        },
        waiver_adjudication_reliability: {
          $ref: "#/components/schemas/WaiverAdjudicationReliabilityAnalytics",
        },
      },
      [
        "criterion_outcomes",
        "evaluation_outcomes",
        "finding_impact",
        "review_applicability",
        "review_run_reliability",
        "waiver_analytics",
        "waiver_adjudication_reliability",
      ],
    ),
    CriterionOutcomeAnalytics: closedObject(
      {
        clear: count,
        clear_rate: rate,
        criterion_id: { minLength: 1, type: "string" },
        error: count,
        error_rate: rate,
        not_applicable: count,
        not_applicable_rate: rate,
        trigger_rate: rate,
        triggered: count,
      },
      [
        "criterion_id",
        "triggered",
        "clear",
        "not_applicable",
        "error",
        "trigger_rate",
        "clear_rate",
        "not_applicable_rate",
        "error_rate",
      ],
    ),
    EvaluationOutcomeAnalytics: closedObject(
      {
        advisory: count,
        advisory_rate: rate,
        blocking: count,
        blocking_rate: rate,
        clear: count,
        clear_rate: rate,
        error: count,
        error_rate: rate,
        pending: count,
      },
      [
        "clear",
        "advisory",
        "blocking",
        "error",
        "pending",
        "clear_rate",
        "advisory_rate",
        "blocking_rate",
        "error_rate",
      ],
    ),
    FindingImpactAnalytics: closedObject(
      {
        advisory: count,
        blocking: count,
        findings_per_triggered_criterion_result: rate,
      },
      ["advisory", "blocking", "findings_per_triggered_criterion_result"],
    ),
    ReviewApplicabilityAnalytics: closedObject(
      {
        applicable: count,
        applicability_rate: rate,
        error: count,
        error_rate: rate,
        not_applicable: count,
        review_id: { minLength: 1, type: "string" },
      },
      [
        "review_id",
        "applicable",
        "not_applicable",
        "error",
        "applicability_rate",
        "error_rate",
      ],
    ),
    ExecutionFailureCodeAnalytics: closedObject(
      {
        code: {
          pattern: "^[a-z][a-z0-9_]*$",
          type: "string",
        },
        count,
      },
      ["code", "count"],
    ),
    TokenCounterAnalytics: closedObject(
      {
        coverage: rate,
        median: nullableMeasurement,
        sum: nullableCount,
      },
      ["sum", "median", "coverage"],
    ),
    ReviewRunReliabilityAnalytics: closedObject(
      {
        active: count,
        duration: closedObject(
          {
            failed: durationSummary,
            operator_cancelled: durationSummary,
            successful: durationSummary,
            superseded: durationSummary,
            terminal: durationSummary,
          },
          [
            "terminal",
            "successful",
            "failed",
            "operator_cancelled",
            "superseded",
          ],
        ),
        failed: count,
        failed_rate: rate,
        failure_codes: failureCodes,
        operator_cancelled: count,
        operator_cancelled_rate: rate,
        successful: count,
        successful_rate: rate,
        superseded: count,
        superseded_rate: rate,
        token_counters: tokenCounters,
      },
      [
        "successful",
        "failed",
        "operator_cancelled",
        "active",
        "successful_rate",
        "failed_rate",
        "operator_cancelled_rate",
        "superseded",
        "superseded_rate",
        "failure_codes",
        "duration",
        "token_counters",
      ],
    ),
    WaiverAdjudicationReliabilityAnalytics: closedObject(
      {
        active: count,
        cancelled: count,
        cancelled_rate: rate,
        completed: count,
        completed_rate: rate,
        duration: closedObject(
          {
            cancelled: durationSummary,
            completed: durationSummary,
            failed: durationSummary,
            terminal: durationSummary,
          },
          ["terminal", "completed", "failed", "cancelled"],
        ),
        failed: count,
        failed_rate: rate,
        failure_codes: failureCodes,
        token_counters: tokenCounters,
      },
      [
        "completed",
        "failed",
        "cancelled",
        "active",
        "completed_rate",
        "failed_rate",
        "cancelled_rate",
        "failure_codes",
        "duration",
        "token_counters",
      ],
    ),
    WaiverAnalytics: closedObject(
      {
        advisory_findings: count,
        decision_history: {
          $ref: "#/components/schemas/WaiverDecisionHistoryAnalytics",
        },
        requested_findings: count,
        waived_findings: count,
        waived_finding_rate: rate,
        waiver_request_rate: rate,
      },
      [
        "advisory_findings",
        "requested_findings",
        "waiver_request_rate",
        "waived_findings",
        "waived_finding_rate",
        "decision_history",
      ],
    ),
    WaiverDecisionHistoryAnalytics: closedObject(
      {
        accepted: count,
        accepted_rate: rate,
        denied: count,
        denied_rate: rate,
        error: count,
        error_rate: rate,
      },
      [
        "accepted",
        "denied",
        "error",
        "accepted_rate",
        "denied_rate",
        "error_rate",
      ],
    ),
  };
}
