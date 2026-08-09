export const MCP_PROTOCOL_VERSION = "2025-11-25";
export const MCP_SERVER_VERSION = "0.1.0";
const JSON_SCHEMA_2020_12 = "https://json-schema.org/draft/2020-12/schema";
const identifier = { minLength: 1, type: "string" };
const evaluationSelector = {
  oneOf: [
    {
      additionalProperties: false,
      properties: {
        name: { minLength: 1, type: "string" },
        type: { const: "branch", type: "string" },
      },
      required: ["type", "name"],
      type: "object",
    },
    {
      additionalProperties: false,
      properties: {
        object_id: {
          pattern: "^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$",
          type: "string",
        },
        type: { const: "commit", type: "string" },
      },
      required: ["type", "object_id"],
      type: "object",
    },
  ],
};

export const MCP_TOOLS = Object.freeze([
  {
    description: "List registered Repositories readable by the implementer.",
    inputSchema: {
      $schema: JSON_SCHEMA_2020_12,
      additionalProperties: false,
      properties: {
        cursor: { minLength: 1, type: "string" },
        limit: { maximum: 100, minimum: 1, type: "integer" },
        remote_url: {
          format: "uri",
          pattern: "^[hH][tT][tT][pP][sS]://",
          type: "string",
        },
      },
      type: "object",
    },
    name: "quality_bar.list_repositories",
  },
  {
    description:
      "Get complete current Repository Guidance without predicting applicability.",
    inputSchema: {
      $schema: JSON_SCHEMA_2020_12,
      additionalProperties: false,
      properties: {
        repository_id: { minLength: 1, type: "string" },
      },
      required: ["repository_id"],
      type: "object",
    },
    name: "quality_bar.get_repository_guidance",
  },
  {
    description:
      "Request an explicit Evaluation and return its durable queued resource.",
    inputSchema: {
      $schema: JSON_SCHEMA_2020_12,
      additionalProperties: false,
      properties: {
        base_selector: evaluationSelector,
        head_selector: evaluationSelector,
        idempotency_key: {
          maxLength: 255,
          minLength: 1,
          pattern: "^[!-~]+$",
          type: "string",
        },
        repository_id: identifier,
      },
      required: [
        "repository_id",
        "base_selector",
        "head_selector",
        "idempotency_key",
      ],
      type: "object",
    },
    name: "quality_bar.request_evaluation",
  },
  {
    description:
      "Get the current canonical Evaluation for client-controlled polling.",
    inputSchema: {
      $schema: JSON_SCHEMA_2020_12,
      additionalProperties: false,
      properties: { evaluation_id: identifier },
      required: ["evaluation_id"],
      type: "object",
    },
    name: "quality_bar.get_evaluation",
  },
  {
    description:
      "Get the complete immutable Evaluation Result, or an exact not-ready error.",
    inputSchema: {
      $schema: JSON_SCHEMA_2020_12,
      additionalProperties: false,
      properties: { evaluation_id: identifier },
      required: ["evaluation_id"],
      type: "object",
    },
    name: "quality_bar.get_evaluation_result",
  },
  {
    description:
      "Atomically submit Waiver Requests and return the queued Waiver Adjudication.",
    inputSchema: {
      $schema: JSON_SCHEMA_2020_12,
      additionalProperties: false,
      properties: {
        evaluation_id: identifier,
        idempotency_key: {
          maxLength: 255,
          minLength: 1,
          pattern: "^[!-~]+$",
          type: "string",
        },
        requests: {
          items: {
            additionalProperties: false,
            properties: {
              finding_id: identifier,
              rationale: { minLength: 1, pattern: "\\S", type: "string" },
            },
            required: ["finding_id", "rationale"],
            type: "object",
          },
          minItems: 1,
          type: "array",
        },
      },
      required: ["evaluation_id", "requests", "idempotency_key"],
      type: "object",
    },
    name: "quality_bar.submit_waiver_requests",
  },
  {
    description:
      "Get the current canonical Waiver Adjudication for client-controlled polling.",
    inputSchema: {
      $schema: JSON_SCHEMA_2020_12,
      additionalProperties: false,
      properties: { waiver_adjudication_id: identifier },
      required: ["waiver_adjudication_id"],
      type: "object",
    },
    name: "quality_bar.get_waiver_adjudication",
  },
]);

export const ONBOARDING_MCP_TOOLS = Object.freeze([
  ...MCP_TOOLS.filter(({ name }) =>
    [
      "quality_bar.list_repositories",
      "quality_bar.get_repository_guidance",
      "quality_bar.request_evaluation",
      "quality_bar.get_evaluation",
      "quality_bar.get_evaluation_result",
    ].includes(name),
  ),
  {
    description: "List active Reviews available during Repository onboarding.",
    inputSchema: {
      $schema: JSON_SCHEMA_2020_12,
      additionalProperties: false,
      type: "object",
    },
    name: "quality_bar.list_reviews",
  },
  {
    description:
      "Register the public HTTPS Repository bound to the onboarding token.",
    inputSchema: {
      $schema: JSON_SCHEMA_2020_12,
      additionalProperties: false,
      properties: {
        url: {
          format: "uri",
          pattern: "^[hH][tT][tT][pP][sS]://",
          type: "string",
        },
      },
      required: ["url"],
      type: "object",
    },
    name: "quality_bar.register_repository",
  },
  {
    description:
      "Atomically set the Repository-specific Reviews selected for the bound Repository.",
    inputSchema: {
      $schema: JSON_SCHEMA_2020_12,
      additionalProperties: false,
      properties: {
        repository_id: identifier,
        review_ids: { items: identifier, type: "array", uniqueItems: true },
      },
      required: ["repository_id", "review_ids"],
      type: "object",
    },
    name: "quality_bar.set_repository_reviews",
  },
  {
    description:
      "Create one approved Review assigned only to the bound Repository.",
    inputSchema: {
      $schema: JSON_SCHEMA_2020_12,
      additionalProperties: false,
      properties: { repository_id: identifier, review: { type: "object" } },
      required: ["repository_id", "review"],
      type: "object",
    },
    name: "quality_bar.create_repository_review",
  },
  {
    description:
      "Update metadata for a Review assigned only to the bound Repository.",
    inputSchema: {
      $schema: JSON_SCHEMA_2020_12,
      additionalProperties: false,
      properties: {
        description: identifier,
        name: identifier,
        review_id: identifier,
      },
      required: ["review_id", "name", "description"],
      type: "object",
    },
    name: "quality_bar.update_repository_review_metadata",
  },
  {
    description:
      "Save an approved version for a Review assigned only to the bound Repository.",
    inputSchema: {
      $schema: JSON_SCHEMA_2020_12,
      additionalProperties: false,
      properties: { review_id: identifier, version: { type: "object" } },
      required: ["review_id", "version"],
      type: "object",
    },
    name: "quality_bar.save_repository_review_version",
  },
  {
    description:
      "Revoke the active onboarding token after acceptance or cancellation.",
    inputSchema: {
      $schema: JSON_SCHEMA_2020_12,
      additionalProperties: false,
      type: "object",
    },
    name: "quality_bar.revoke_onboarding_token",
  },
]);

export const MCP_RESOURCE_TEMPLATES = Object.freeze([
  {
    description: "Canonical Repository resource.",
    mimeType: "application/json",
    name: "quality_bar.repository",
    uriTemplate: "quality-bar://v1/repositories/{repository_id}",
  },
  {
    description: "Complete current canonical Repository Guidance.",
    mimeType: "application/json",
    name: "quality_bar.repository_guidance",
    uriTemplate: "quality-bar://v1/repositories/{repository_id}/guidance",
  },
  {
    description: "Current canonical Evaluation.",
    mimeType: "application/json",
    name: "quality_bar.evaluation",
    uriTemplate: "quality-bar://v1/evaluations/{evaluation_id}",
  },
  {
    description: "Complete immutable canonical Evaluation Result.",
    mimeType: "application/json",
    name: "quality_bar.evaluation_result",
    uriTemplate: "quality-bar://v1/evaluations/{evaluation_id}/result",
  },
  {
    description: "Complete canonical Review Run.",
    mimeType: "application/json",
    name: "quality_bar.review_run",
    uriTemplate: "quality-bar://v1/review-runs/{review_run_id}",
  },
  {
    description: "Complete canonical Finding.",
    mimeType: "application/json",
    name: "quality_bar.finding",
    uriTemplate: "quality-bar://v1/findings/{finding_id}",
  },
  {
    description: "Complete immutable canonical Waiver Request.",
    mimeType: "application/json",
    name: "quality_bar.waiver_request",
    uriTemplate: "quality-bar://v1/waiver-requests/{waiver_request_id}",
  },
  {
    description: "Current canonical Waiver Adjudication.",
    mimeType: "application/json",
    name: "quality_bar.waiver_adjudication",
    uriTemplate:
      "quality-bar://v1/waiver-adjudications/{waiver_adjudication_id}",
  },
  {
    description: "Complete immutable canonical Waiver Decision.",
    mimeType: "application/json",
    name: "quality_bar.waiver_decision",
    uriTemplate: "quality-bar://v1/waiver-decisions/{waiver_decision_id}",
  },
]);

export function mcpInitializeResult() {
  return {
    capabilities: { resources: {}, tools: {} },
    protocolVersion: MCP_PROTOCOL_VERSION,
    serverInfo: { name: "quality-bar", version: MCP_SERVER_VERSION },
  };
}
