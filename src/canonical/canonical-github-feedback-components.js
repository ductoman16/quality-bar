import { closedObject } from "./canonical-schema.js";

export function canonicalGitHubDeliveryProperties() {
  const timestamp = {
    oneOf: [{ format: "date-time", type: "string" }, { type: "null" }],
  };
  return {
    attempt_count: { minimum: 0, type: "integer" },
    connection_identity: {
      oneOf: [{ minLength: 1, type: "string" }, { type: "null" }],
    },
    last_attempt_at: timestamp,
    next_attempt_at: timestamp,
    provider_gate_error: {
      oneOf: [{ $ref: "GitHubFeedbackPublicationError#" }, { type: "null" }],
    },
    provider_gate_until: timestamp,
    reconciliation_required: { type: "boolean" },
    source_identity: { minLength: 1, type: "string" },
    target: { minLength: 1, type: "string" },
  };
}

export const GITHUB_DELIVERY_REQUIRED = [
  "source_identity",
  "connection_identity",
  "target",
  "attempt_count",
  "last_attempt_at",
  "provider_gate_until",
  "provider_gate_error",
  "next_attempt_at",
  "reconciliation_required",
];

export function canonicalGitHubFeedbackSchemas() {
  const error = {
    oneOf: [{ $ref: "GitHubFeedbackPublicationError#" }, { type: "null" }],
  };
  const externalId = {
    oneOf: [{ minimum: 1, type: "integer" }, { type: "null" }],
  };
  const publishedAt = {
    oneOf: [{ format: "date-time", type: "string" }, { type: "null" }],
  };
  return {
    GitHubFeedbackPublicationError: closedObject(
      {
        code: {
          pattern: "^[a-z][a-z0-9_]*$",
          type: "string",
        },
        detail: { minLength: 1, type: "string" },
      },
      ["code", "detail"],
    ),
    GitHubAggregateFeedbackPublication: closedObject(
      {
        ...canonicalGitHubDeliveryProperties(),
        error,
        external_id: externalId,
        publication_status: {
          enum: ["waiting", "succeeded", "unavailable"],
          type: "string",
        },
        published_at: publishedAt,
      },
      [
        ...GITHUB_DELIVERY_REQUIRED,
        "publication_status",
        "external_id",
        "published_at",
        "error",
      ],
    ),
    GitHubFindingFeedbackPublication: closedObject(
      {
        ...canonicalGitHubDeliveryProperties(),
        error,
        external_id: externalId,
        finding_id: { minLength: 1, type: "string" },
        publication_status: {
          enum: ["aggregate_only", "waiting", "succeeded", "unavailable"],
          type: "string",
        },
        published_at: publishedAt,
      },
      [
        ...GITHUB_DELIVERY_REQUIRED,
        "finding_id",
        "publication_status",
        "external_id",
        "published_at",
        "error",
      ],
    ),
    GitHubEvaluationFeedback: closedObject(
      {
        aggregate: {
          $ref: "GitHubAggregateFeedbackPublication#",
        },
        findings: {
          items: {
            $ref: "GitHubFindingFeedbackPublication#",
          },
          type: "array",
        },
      },
      ["aggregate", "findings"],
    ),
  };
}
