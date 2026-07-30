import { closedObject } from "./canonical-schema.js";

export function canonicalWaiverSchemas() {
  return {
    WaiverBatchRequestItem: closedObject(
      {
        finding_id: { minLength: 1, type: "string" },
        rationale: { minLength: 1, pattern: "\\S", type: "string" },
      },
      ["finding_id", "rationale"],
    ),
    WaiverBatchRequest: closedObject(
      {
        requests: {
          items: { $ref: "#/components/schemas/WaiverBatchRequestItem" },
          minItems: 1,
          type: "array",
        },
      },
      ["requests"],
    ),
    WaiverErrorRetryRequest: closedObject(
      {
        request_ids: {
          items: { minLength: 1, type: "string" },
          minItems: 1,
          type: "array",
          uniqueItems: true,
        },
      },
      ["request_ids"],
    ),
    WaiverRequest: closedObject(
      {
        created_at: { format: "date-time", type: "string" },
        evaluation_id: { minLength: 1, type: "string" },
        finding_id: { minLength: 1, type: "string" },
        id: { minLength: 1, type: "string" },
        rationale: { minLength: 1, pattern: "\\S", type: "string" },
      },
      ["id", "evaluation_id", "finding_id", "rationale", "created_at"],
    ),
    WaiverAdjudication: closedObject(
      {
        base_commit: {
          pattern: "^(?:[0-9a-f]{40}|[0-9a-f]{64})$",
          type: "string",
        },
        configuration: { $ref: "#/components/schemas/CodexConfiguration" },
        created_at: { format: "date-time", type: "string" },
        evaluation_id: { minLength: 1, type: "string" },
        execution_status: {
          enum: ["queued", "running", "completed", "failed", "cancelled"],
          type: "string",
        },
        head_commit: {
          pattern: "^(?:[0-9a-f]{40}|[0-9a-f]{64})$",
          type: "string",
        },
        id: { minLength: 1, type: "string" },
        request_ids: {
          items: { minLength: 1, type: "string" },
          minItems: 1,
          type: "array",
        },
      },
      [
        "id",
        "evaluation_id",
        "base_commit",
        "head_commit",
        "request_ids",
        "configuration",
        "execution_status",
        "created_at",
      ],
    ),
    WaiverBatch: closedObject(
      {
        adjudication: { $ref: "#/components/schemas/WaiverAdjudication" },
        requests: {
          items: { $ref: "#/components/schemas/WaiverRequest" },
          minItems: 1,
          type: "array",
        },
      },
      ["requests", "adjudication"],
    ),
  };
}
