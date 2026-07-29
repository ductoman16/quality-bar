import { closedObject } from "./canonical-schema.js";

export function canonicalReviewRunSchemas() {
  const nullableTimestamp = {
    oneOf: [{ format: "date-time", type: "string" }, { type: "null" }],
  };
  const nullableCounter = {
    oneOf: [{ minimum: 0, type: "integer" }, { type: "null" }],
  };
  const measurements = closedObject(
    {
      codex_cli_version: {
        oneOf: [{ minLength: 1, type: "string" }, { type: "null" }],
      },
      duration_ms: nullableCounter,
      process: {
        oneOf: [
          closedObject(
            {
              code: { minimum: 0, type: "integer" },
              kind: { const: "exit", type: "string" },
            },
            ["kind", "code"],
          ),
          closedObject(
            {
              kind: { const: "signal", type: "string" },
              signal: { minLength: 1, type: "string" },
            },
            ["kind", "signal"],
          ),
          closedObject({ kind: { const: "unavailable", type: "string" } }, [
            "kind",
          ]),
        ],
      },
      token_counters: closedObject(
        {
          cached_input_tokens: nullableCounter,
          input_tokens: nullableCounter,
          output_tokens: nullableCounter,
        },
        ["input_tokens", "cached_input_tokens", "output_tokens"],
      ),
    },
    ["codex_cli_version", "duration_ms", "process", "token_counters"],
  );
  const properties = {
    completed_at: nullableTimestamp,
    created_at: { format: "date-time", type: "string" },
    criterion_results: {
      items: { $ref: "#/components/schemas/CriterionResult" },
      type: "array",
    },
    evaluation_id: { minLength: 1, type: "string" },
    findings: {
      items: { $ref: "#/components/schemas/Finding" },
      type: "array",
    },
    id: { minLength: 1, type: "string" },
    measurements,
    review_id: { minLength: 1, type: "string" },
    review_version_id: { minLength: 1, type: "string" },
    started_at: nullableTimestamp,
  };
  const required = [
    "id",
    "evaluation_id",
    "review_id",
    "review_version_id",
    "execution_status",
    "created_at",
    "started_at",
    "completed_at",
    "measurements",
    "criterion_results",
    "findings",
  ];
  const error = closedObject(
    {
      code: { pattern: "^[a-z][a-z0-9_]*$", type: "string" },
      detail: { minLength: 1, type: "string" },
    },
    ["code", "detail"],
  );

  return {
    QueuedReviewRun: closedObject(
      {
        ...properties,
        completed_at: { type: "null" },
        execution_status: { const: "queued", type: "string" },
        started_at: { type: "null" },
      },
      required,
    ),
    RunningReviewRun: closedObject(
      {
        ...properties,
        completed_at: { type: "null" },
        execution_status: { const: "running", type: "string" },
        started_at: { format: "date-time", type: "string" },
      },
      required,
    ),
    CompletedReviewRun: closedObject(
      {
        ...properties,
        completed_at: { format: "date-time", type: "string" },
        execution_status: { const: "completed", type: "string" },
        started_at: { format: "date-time", type: "string" },
      },
      required,
    ),
    FailedReviewRun: closedObject(
      {
        ...properties,
        completed_at: { format: "date-time", type: "string" },
        error,
        execution_status: { const: "failed", type: "string" },
        started_at: { format: "date-time", type: "string" },
      },
      [...required, "error"],
    ),
    CancelledReviewRun: closedObject(
      {
        ...properties,
        completed_at: { format: "date-time", type: "string" },
        error: closedObject(
          {
            code: { const: "cancelled_by_operator", type: "string" },
            detail: { minLength: 1, type: "string" },
          },
          ["code", "detail"],
        ),
        execution_status: { const: "cancelled", type: "string" },
      },
      [...required, "error"],
    ),
    ReviewRun: {
      oneOf: [
        { $ref: "#/components/schemas/QueuedReviewRun" },
        { $ref: "#/components/schemas/RunningReviewRun" },
        { $ref: "#/components/schemas/CompletedReviewRun" },
        { $ref: "#/components/schemas/FailedReviewRun" },
        { $ref: "#/components/schemas/CancelledReviewRun" },
      ],
    },
    TerminalReviewRun: {
      oneOf: [
        { $ref: "#/components/schemas/CompletedReviewRun" },
        { $ref: "#/components/schemas/FailedReviewRun" },
        { $ref: "#/components/schemas/CancelledReviewRun" },
      ],
    },
  };
}
