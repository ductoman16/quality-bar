import { closedObject } from "./canonical-schema.js";

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
