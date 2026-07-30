import { closedObject } from "./canonical-schema.js";

const adjudicationProperties = {
  base_commit: {
    pattern: "^(?:[0-9a-f]{40}|[0-9a-f]{64})$",
    type: "string",
  },
  completed_at: { format: "date-time", type: ["string", "null"] },
  configuration: { $ref: "#/components/schemas/CodexConfiguration" },
  created_at: { format: "date-time", type: "string" },
  evaluation_id: { minLength: 1, type: "string" },
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
  started_at: { format: "date-time", type: ["string", "null"] },
};
const adjudicationRequired = [
  "id",
  "evaluation_id",
  "base_commit",
  "head_commit",
  "request_ids",
  "configuration",
  "execution_status",
  "created_at",
];

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
    WaiverAdjudication: {
      oneOf: [
        closedObject(
          {
            ...adjudicationProperties,
            execution_status: {
              enum: ["queued", "running", "cancelled"],
              type: "string",
            },
          },
          adjudicationRequired,
        ),
        closedObject(
          {
            ...adjudicationProperties,
            decisions: {
              items: { $ref: "#/components/schemas/WaiverDecision" },
              minItems: 1,
              type: "array",
            },
            execution_status: { const: "completed", type: "string" },
          },
          [...adjudicationRequired, "decisions"],
        ),
        closedObject(
          {
            ...adjudicationProperties,
            error: closedObject(
              {
                code: { minLength: 1, type: "string" },
                detail: { minLength: 1, type: "string" },
              },
              ["code", "detail"],
            ),
            execution_status: { const: "failed", type: "string" },
          },
          [...adjudicationRequired, "error"],
        ),
      ],
    },
    WaiverDecision: {
      oneOf: [
        closedObject(
          {
            created_at: { format: "date-time", type: "string" },
            explanation: { minLength: 1, pattern: "\\S", type: "string" },
            id: { minLength: 1, type: "string" },
            outcome: {
              enum: ["accepted", "denied"],
              type: "string",
            },
            request_id: { minLength: 1, type: "string" },
            waiver_adjudication_id: { minLength: 1, type: "string" },
          },
          [
            "id",
            "waiver_adjudication_id",
            "request_id",
            "outcome",
            "explanation",
            "created_at",
          ],
        ),
        closedObject(
          {
            created_at: { format: "date-time", type: "string" },
            error: closedObject(
              {
                code: { minLength: 1, type: "string" },
                detail: { minLength: 1, type: "string" },
              },
              ["code", "detail"],
            ),
            id: { minLength: 1, type: "string" },
            outcome: { const: "error", type: "string" },
            request_id: { minLength: 1, type: "string" },
            waiver_adjudication_id: { minLength: 1, type: "string" },
          },
          [
            "id",
            "waiver_adjudication_id",
            "request_id",
            "outcome",
            "error",
            "created_at",
          ],
        ),
      ],
    },
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
