import { closedObject } from "./canonical-schema.js";

export function canonicalGitHubFeedbackSchemas() {
  const error = {
    oneOf: [
      { $ref: "#/components/schemas/GitHubFeedbackPublicationError" },
      { type: "null" },
    ],
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
        error,
        external_id: externalId,
        publication_status: {
          enum: ["waiting", "succeeded", "unavailable"],
          type: "string",
        },
        published_at: publishedAt,
      },
      ["publication_status", "external_id", "published_at", "error"],
    ),
    GitHubFindingFeedbackPublication: closedObject(
      {
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
          $ref: "#/components/schemas/GitHubAggregateFeedbackPublication",
        },
        findings: {
          items: {
            $ref: "#/components/schemas/GitHubFindingFeedbackPublication",
          },
          type: "array",
        },
      },
      ["aggregate", "findings"],
    ),
  };
}
