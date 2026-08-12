import { closedObject } from "./canonical-schema.js";

export function canonicalEvaluationMonitorSchemas() {
  return {
    EvaluationMonitorSystemNode: closedObject(
      {
        key: { enum: ["preparing", "finalizing"], type: "string" },
        kind: { const: "system", type: "string" },
        label: { enum: ["Preparing", "Finalizing"], type: "string" },
        status: {
          enum: ["queued", "running", "completed", "failed", "cancelled"],
          type: "string",
        },
      },
      ["kind", "key", "label", "status"],
    ),
    EvaluationMonitorReviewNode: closedObject(
      {
        kind: { const: "review", type: "string" },
        label: { minLength: 1, type: "string" },
        outcome: {
          oneOf: [
            {
              enum: ["clear", "advisory", "blocking", "error"],
              type: "string",
            },
            { type: "null" },
          ],
        },
        review_id: { minLength: 1, type: "string" },
        review_version_id: { minLength: 1, type: "string" },
        status: {
          enum: ["queued", "running", "completed", "failed", "cancelled"],
          type: "string",
        },
      },
      ["kind", "review_id", "review_version_id", "label", "outcome", "status"],
    ),
    EvaluationMonitor: closedObject(
      {
        duration_ms: {
          oneOf: [{ minimum: 0, type: "integer" }, { type: "null" }],
        },
        finding_counts: {
          oneOf: [
            closedObject(
              {
                advisory: { minimum: 0, type: "integer" },
                blocking: { minimum: 0, type: "integer" },
                total: { minimum: 0, type: "integer" },
              },
              ["total", "advisory", "blocking"],
            ),
            { type: "null" },
          ],
        },
        nodes: {
          items: {
            oneOf: [
              { $ref: "#/components/schemas/EvaluationMonitorSystemNode" },
              { $ref: "#/components/schemas/EvaluationMonitorReviewNode" },
            ],
          },
          minItems: 2,
          type: "array",
        },
        outcome_counts: {
          oneOf: [
            closedObject(
              {
                clear: { minimum: 0, type: "integer" },
                error: { minimum: 0, type: "integer" },
                not_applicable: { minimum: 0, type: "integer" },
                triggered: { minimum: 0, type: "integer" },
              },
              ["clear", "triggered", "not_applicable", "error"],
            ),
            { type: "null" },
          ],
        },
        review_counts: closedObject(
          {
            cancelled: { minimum: 0, type: "integer" },
            completed: { minimum: 0, type: "integer" },
            failed: { minimum: 0, type: "integer" },
            queued: { minimum: 0, type: "integer" },
            running: { minimum: 0, type: "integer" },
            total: { minimum: 0, type: "integer" },
          },
          ["total", "queued", "running", "completed", "failed", "cancelled"],
        ),
      },
      [
        "nodes",
        "review_counts",
        "outcome_counts",
        "finding_counts",
        "duration_ms",
      ],
    ),
  };
}
