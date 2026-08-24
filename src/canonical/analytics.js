import { closedObject } from "./schema.js";

export const count = { minimum: 0, type: "integer" };
export const rate = closedObject({ denominator: count, numerator: count }, [
  "numerator",
  "denominator",
]);
export const nullableCount = { oneOf: [count, { type: "null" }] };
export const nullableMeasurement = {
  oneOf: [{ minimum: 0, type: "number" }, { type: "null" }],
};
export const durationSummary = closedObject(
  {
    execution_count: count,
    median_ms: nullableMeasurement,
    total_ms: nullableCount,
  },
  ["execution_count", "median_ms", "total_ms"],
);
export const tokenCounters = closedObject(
  {
    cached_input_tokens: { $ref: "TokenCounterAnalytics#" },
    input_tokens: { $ref: "TokenCounterAnalytics#" },
    output_tokens: { $ref: "TokenCounterAnalytics#" },
  },
  ["input_tokens", "cached_input_tokens", "output_tokens"],
);
export const failureCodes = {
  items: { $ref: "ExecutionFailureCodeAnalytics#" },
  type: "array",
};
export const analyticsFilters = closedObject(
  {
    base_commit: {
      pattern: "^([0-9a-f]{40}|[0-9a-f]{64})$",
      type: "string",
    },
    criterion_id: { minLength: 1, type: "string" },
    end: count,
    head_commit: {
      pattern: "^([0-9a-f]{40}|[0-9a-f]{64})$",
      type: "string",
    },
    model: { minLength: 1, type: "string" },
    pull_request_number: { minimum: 1, type: "integer" },
    reasoning_effort: { minLength: 1, type: "string" },
    repository_id: { minLength: 1, type: "string" },
    review_id: { minLength: 1, type: "string" },
    review_version_id: { minLength: 1, type: "string" },
    service_tier: { minLength: 1, type: "string" },
    start: count,
    terminal_outcome: {
      enum: ["clear", "advisory", "blocking", "error"],
      type: "string",
    },
  },
  [],
);

const matchingCommit = {
  pattern: "^([0-9a-f]{40}|[0-9a-f]{64})$",
  type: "string",
};
const matchingStableErrorCode = {
  pattern: "^[a-z][a-z0-9_]*$",
  type: "string",
};

export function canonicalAnalyticsMatchingSchemas() {
  return {
    AnalyticsMatchingFacts: closedObject(
      {
        evaluations: {
          items: { $ref: "AnalyticsEvaluationFact#" },
          type: "array",
        },
        review_runs: {
          items: { $ref: "AnalyticsReviewRunFact#" },
          type: "array",
        },
      },
      ["evaluations", "review_runs"],
    ),
    AnalyticsEvaluationFact: closedObject(
      {
        base_commit: matchingCommit,
        created_at: count,
        evaluation_id: { minLength: 1, type: "string" },
        head_commit: matchingCommit,
        pull_request_number: {
          oneOf: [{ minimum: 1, type: "integer" }, { type: "null" }],
        },
        repository_id: { minLength: 1, type: "string" },
        terminal_outcome: {
          enum: ["clear", "advisory", "blocking", "error", "pending"],
          type: "string",
        },
      },
      [
        "evaluation_id",
        "repository_id",
        "base_commit",
        "head_commit",
        "pull_request_number",
        "created_at",
        "terminal_outcome",
      ],
    ),
    AnalyticsReviewRunFact: closedObject(
      {
        base_commit: matchingCommit,
        cached_input_tokens: nullableCount,
        cancellation_code: {
          oneOf: [
            {
              enum: ["cancelled_by_operator", "cancelled_by_supersession"],
              type: "string",
            },
            { type: "null" },
          ],
        },
        completed_at: nullableCount,
        created_at: count,
        criterion_results: {
          items: { $ref: "AnalyticsCriterionFact#" },
          type: "array",
        },
        error_code: {
          oneOf: [matchingStableErrorCode, { type: "null" }],
        },
        evaluation_id: { minLength: 1, type: "string" },
        execution_status: {
          enum: ["queued", "running", "completed", "failed", "cancelled"],
          type: "string",
        },
        findings: {
          items: { $ref: "AnalyticsFindingFact#" },
          type: "array",
        },
        head_commit: matchingCommit,
        input_tokens: nullableCount,
        model: { minLength: 1, type: "string" },
        output_tokens: nullableCount,
        pull_request_number: {
          oneOf: [{ minimum: 1, type: "integer" }, { type: "null" }],
        },
        reasoning_effort: { minLength: 1, type: "string" },
        repository_id: { minLength: 1, type: "string" },
        review_id: { minLength: 1, type: "string" },
        review_run_id: { minLength: 1, type: "string" },
        review_version_id: { minLength: 1, type: "string" },
        service_tier: { minLength: 1, type: "string" },
        started_at: nullableCount,
        waiver_decisions: {
          items: { $ref: "AnalyticsWaiverDecisionFact#" },
          type: "array",
        },
        waiver_requests: {
          items: { $ref: "AnalyticsWaiverRequestFact#" },
          type: "array",
        },
      },
      [
        "review_run_id",
        "evaluation_id",
        "repository_id",
        "base_commit",
        "head_commit",
        "pull_request_number",
        "review_id",
        "review_version_id",
        "model",
        "reasoning_effort",
        "service_tier",
        "execution_status",
        "cancellation_code",
        "created_at",
        "started_at",
        "completed_at",
        "error_code",
        "input_tokens",
        "cached_input_tokens",
        "output_tokens",
        "criterion_results",
        "findings",
        "waiver_requests",
        "waiver_decisions",
      ],
    ),
    AnalyticsCriterionFact: closedObject(
      {
        criterion_id: { minLength: 1, type: "string" },
        outcome: {
          enum: ["clear", "triggered", "not_applicable", "error"],
          type: "string",
        },
      },
      ["criterion_id", "outcome"],
    ),
    AnalyticsFindingFact: closedObject(
      {
        criterion_id: { minLength: 1, type: "string" },
        finding_id: { minLength: 1, type: "string" },
        impact: { enum: ["advisory", "blocking"], type: "string" },
      },
      ["finding_id", "criterion_id", "impact"],
    ),
    AnalyticsWaiverRequestFact: closedObject(
      {
        created_at: count,
        finding_id: { minLength: 1, type: "string" },
        waiver_request_id: { minLength: 1, type: "string" },
      },
      ["waiver_request_id", "finding_id", "created_at"],
    ),
    AnalyticsWaiverDecisionFact: closedObject(
      {
        created_at: count,
        outcome: {
          enum: ["accepted", "denied", "error"],
          type: "string",
        },
        waiver_decision_id: { minLength: 1, type: "string" },
        waiver_request_id: { minLength: 1, type: "string" },
      },
      ["waiver_decision_id", "waiver_request_id", "outcome", "created_at"],
    ),
  };
}

export function canonicalAnalyticsSchemas() {
  return {
    Analytics: closedObject(
      {
        criterion_outcomes: {
          items: { $ref: "CriterionOutcomeAnalytics#" },
          type: "array",
        },
        daily_trend: {
          items: { $ref: "DailyTrendBucket#" },
          type: "array",
        },
        evaluation_outcomes: {
          $ref: "EvaluationOutcomeAnalytics#",
        },
        evaluation_overview: {
          $ref: "EvaluationOverviewAnalytics#",
        },
        finding_impact: {
          $ref: "FindingImpactAnalytics#",
        },
        matching_facts: {
          $ref: "AnalyticsMatchingFacts#",
        },
        population: { $ref: "AnalyticsPopulation#" },
        pull_request_criterion_transitions: {
          $ref: "PullRequestCriterionTransitions#",
        },
        review_applicability: {
          items: { $ref: "ReviewApplicabilityAnalytics#" },
          type: "array",
        },
        review_run_reliability: {
          $ref: "ReviewRunReliabilityAnalytics#",
        },
        waiver_analytics: {
          $ref: "WaiverAnalytics#",
        },
        waiver_adjudication_reliability: {
          $ref: "WaiverAdjudicationReliabilityAnalytics#",
        },
      },
      [
        "criterion_outcomes",
        "daily_trend",
        "evaluation_outcomes",
        "evaluation_overview",
        "finding_impact",
        "matching_facts",
        "population",
        "pull_request_criterion_transitions",
        "review_applicability",
        "review_run_reliability",
        "waiver_analytics",
        "waiver_adjudication_reliability",
      ],
    ),
    ...canonicalAnalyticsMatchingSchemas(),
    DailyTrendBucket: closedObject(
      {
        advisory: count,
        blocking: count,
        clear: count,
        date: { type: "string" },
        error: count,
        evaluations: count,
        pending: count,
      },
      [
        "advisory",
        "blocking",
        "clear",
        "date",
        "error",
        "evaluations",
        "pending",
      ],
    ),
    AnalyticsPopulation: closedObject(
      {
        filters: analyticsFilters,
        matching_evaluations: count,
        matching_waiver_adjudications: count,
        matching_waiver_decisions: count,
        matching_waiver_requests: count,
        pending_adjudications: count,
        pending_evaluations: count,
        state: {
          enum: ["no_evaluations", "no_filter_match", "pending_data", "ready"],
          type: "string",
        },
        total_evaluations: count,
      },
      [
        "filters",
        "matching_evaluations",
        "matching_waiver_requests",
        "matching_waiver_decisions",
        "matching_waiver_adjudications",
        "pending_evaluations",
        "pending_adjudications",
        "state",
        "total_evaluations",
      ],
    ),
    PullRequestCriterionTransitions: closedObject(
      {
        no_longer_applicable: count,
        sample_size: count,
        triggered_to_clear: count,
        triggered_to_error: count,
      },
      [
        "triggered_to_clear",
        "no_longer_applicable",
        "triggered_to_error",
        "sample_size",
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
    EvaluationOverviewAnalytics: closedObject(
      {
        clear_count: count,
        duration_sample_count: count,
        p95_duration_ms: nullableCount,
        clear_rate: rate,
        terminal_count: count,
        window: closedObject(
          {
            end: count,
            start: count,
          },
          ["start", "end"],
        ),
      },
      [
        "window",
        "terminal_count",
        "clear_count",
        "clear_rate",
        "duration_sample_count",
        "p95_duration_ms",
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
          $ref: "WaiverDecisionHistoryAnalytics#",
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
