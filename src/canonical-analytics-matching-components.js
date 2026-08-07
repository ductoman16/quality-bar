import { closedObject } from "./canonical-schema.js";

const count = { minimum: 0, type: "integer" };
const nullableCount = {
  oneOf: [count, { type: "null" }],
};
const commit = { pattern: "^([0-9a-f]{40}|[0-9a-f]{64})$", type: "string" };
const stableErrorCode = {
  pattern: "^[a-z][a-z0-9_]*$",
  type: "string",
};

export function canonicalAnalyticsMatchingSchemas() {
  return {
    AnalyticsMatchingFacts: closedObject(
      {
        evaluations: {
          items: { $ref: "#/components/schemas/AnalyticsEvaluationFact" },
          type: "array",
        },
        review_runs: {
          items: { $ref: "#/components/schemas/AnalyticsReviewRunFact" },
          type: "array",
        },
      },
      ["evaluations", "review_runs"],
    ),
    AnalyticsEvaluationFact: closedObject(
      {
        base_commit: commit,
        created_at: count,
        evaluation_id: { minLength: 1, type: "string" },
        head_commit: commit,
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
        base_commit: commit,
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
          items: { $ref: "#/components/schemas/AnalyticsCriterionFact" },
          type: "array",
        },
        error_code: {
          oneOf: [stableErrorCode, { type: "null" }],
        },
        evaluation_id: { minLength: 1, type: "string" },
        execution_status: {
          enum: ["queued", "running", "completed", "failed", "cancelled"],
          type: "string",
        },
        findings: {
          items: { $ref: "#/components/schemas/AnalyticsFindingFact" },
          type: "array",
        },
        head_commit: commit,
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
          items: { $ref: "#/components/schemas/AnalyticsWaiverDecisionFact" },
          type: "array",
        },
        waiver_requests: {
          items: { $ref: "#/components/schemas/AnalyticsWaiverRequestFact" },
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
