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
  const emptyDecisions = { maxItems: 0, type: "array" };
  const decisions = {
    items: { $ref: "#/components/schemas/WaiverOperationalDecision" },
    type: "array",
  };
  const identifier = { minLength: 1, type: "string" };
  const nullValue = { type: "null" };
  const nullableTimestamp = {
    oneOf: [{ format: "date-time", type: "string" }, nullValue],
  };
  const nullableError = {
    oneOf: [
      { $ref: "#/components/schemas/WaiverOperationalError" },
      { type: "null" },
    ],
  };
  const operationalProperties = {
    completed_at: nullableTimestamp,
    decisions,
    exhausted_at: nullableTimestamp,
    execution_status: { type: "string" },
    id: identifier,
    next_attempt_at: nullableTimestamp,
    pre_start_attempt_count: { minimum: 0, type: "integer" },
    request_ids: {
      items: identifier,
      minItems: 1,
      type: "array",
      uniqueItems: true,
    },
    retry_cycle: { minimum: 1, type: "integer" },
    retry_error: nullableError,
    retry_state: { type: "string" },
    started_at: nullableTimestamp,
  };
  const operationalRequired = Object.keys(operationalProperties);
  /** @param {Record<string, any>} properties */
  const operational = (properties) =>
    closedObject(
      { ...operationalProperties, ...properties },
      operationalRequired,
    );
  return {
    WaiverOperationalError: closedObject(
      {
        code: {
          minLength: 1,
          pattern: "^[a-z][a-z0-9_]*$",
          type: "string",
        },
        detail: { minLength: 1, pattern: "\\S", type: "string" },
      },
      ["code", "detail"],
    ),
    WaiverAcceptedOrDeniedDecision: closedObject(
      {
        explanation: { minLength: 1, pattern: "\\S", type: "string" },
        id: identifier,
        outcome: { enum: ["accepted", "denied"], type: "string" },
        request_id: identifier,
      },
      ["id", "request_id", "outcome", "explanation"],
    ),
    WaiverErrorDecision: closedObject(
      {
        error: { $ref: "#/components/schemas/WaiverOperationalError" },
        id: identifier,
        outcome: { const: "error", type: "string" },
        request_id: identifier,
      },
      ["id", "request_id", "outcome", "error"],
    ),
    WaiverOperationalDecision: {
      oneOf: [
        { $ref: "#/components/schemas/WaiverAcceptedOrDeniedDecision" },
        { $ref: "#/components/schemas/WaiverErrorDecision" },
      ],
    },
    WaiverQueuedReadyAdjudication: operational({
      completed_at: nullValue,
      decisions: emptyDecisions,
      exhausted_at: nullValue,
      execution_status: { const: "queued", type: "string" },
      next_attempt_at: { format: "date-time", type: "string" },
      retry_state: { const: "ready", type: "string" },
      started_at: nullValue,
    }),
    WaiverQueuedExhaustedAdjudication: operational({
      completed_at: nullValue,
      decisions: emptyDecisions,
      exhausted_at: { format: "date-time", type: "string" },
      execution_status: { const: "queued", type: "string" },
      next_attempt_at: nullValue,
      pre_start_attempt_count: { minimum: 1, type: "integer" },
      retry_error: { $ref: "#/components/schemas/WaiverOperationalError" },
      retry_state: { const: "exhausted", type: "string" },
      started_at: nullValue,
    }),
    WaiverRunningAdjudication: operational({
      completed_at: nullValue,
      decisions: emptyDecisions,
      exhausted_at: nullValue,
      execution_status: { const: "running", type: "string" },
      next_attempt_at: nullValue,
      retry_state: { const: "ready", type: "string" },
      started_at: { format: "date-time", type: "string" },
    }),
    WaiverCompletedAdjudication: operational({
      completed_at: { format: "date-time", type: "string" },
      decisions: { ...decisions, minItems: 1 },
      exhausted_at: nullValue,
      execution_status: { const: "completed", type: "string" },
      next_attempt_at: nullValue,
      retry_state: { const: "ready", type: "string" },
      started_at: { format: "date-time", type: "string" },
    }),
    WaiverFailedAdjudication: closedObject(
      {
        ...operationalProperties,
        completed_at: { format: "date-time", type: "string" },
        decisions: emptyDecisions,
        error: { $ref: "#/components/schemas/WaiverOperationalError" },
        exhausted_at: nullValue,
        execution_status: { const: "failed", type: "string" },
        next_attempt_at: nullValue,
        retry_state: { const: "ready", type: "string" },
        started_at: { format: "date-time", type: "string" },
      },
      [...operationalRequired, "error"],
    ),
    WaiverCancelledAdjudication: operational({
      completed_at: { format: "date-time", type: "string" },
      decisions: emptyDecisions,
      exhausted_at: nullValue,
      execution_status: { const: "cancelled", type: "string" },
      next_attempt_at: nullValue,
      retry_state: { const: "ready", type: "string" },
      started_at: { format: "date-time", type: "string" },
    }),
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
              enum: ["queued", "running"],
              type: "string",
            },
          },
          adjudicationRequired,
        ),
        closedObject(
          {
            ...adjudicationProperties,
            error: closedObject(
              {
                code: {
                  const: "waiver_adjudication_cancelled",
                  type: "string",
                },
                detail: {
                  const: "Waiver Adjudication was cancelled",
                  type: "string",
                },
              },
              ["code", "detail"],
            ),
            execution_status: { const: "cancelled", type: "string" },
          },
          [...adjudicationRequired, "error"],
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
    WaiverAdjudicationOperational: {
      oneOf: [
        { $ref: "#/components/schemas/WaiverQueuedReadyAdjudication" },
        { $ref: "#/components/schemas/WaiverQueuedExhaustedAdjudication" },
        { $ref: "#/components/schemas/WaiverRunningAdjudication" },
        { $ref: "#/components/schemas/WaiverCompletedAdjudication" },
        { $ref: "#/components/schemas/WaiverFailedAdjudication" },
        { $ref: "#/components/schemas/WaiverCancelledAdjudication" },
      ],
    },
    WaiverAdjudicationOperationalCollection: closedObject(
      {
        items: {
          items: {
            $ref: "#/components/schemas/WaiverAdjudicationOperational",
          },
          type: "array",
        },
      },
      ["items"],
    ),
  };
}
