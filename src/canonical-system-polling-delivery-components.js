import { closedObject } from "./canonical-schema.js";

const error = {
  $ref: "#/components/schemas/SystemPollingDeliveryError",
};
const nullableError = { oneOf: [error, { type: "null" }] };
const nullableTimestamp = { format: "date-time", type: ["string", "null"] };
const pollingConnectionProperties = {
  connection_id: { minLength: 1, type: "string" },
  error: nullableError,
  health: { enum: ["healthy", "error"], type: "string" },
  health_error: nullableError,
  lifecycle: { enum: ["enabled", "retired"], type: "string" },
  next_attempt_at: nullableTimestamp,
  next_attempt_after_correction: { type: "boolean" },
  rate_gate_until: nullableTimestamp,
  repositories: {
    items: {
      $ref: "#/components/schemas/SystemPollingRepositoryFact",
    },
    type: "array",
  },
};
const pollingConnectionRequired = [
  "connection_id",
  "error",
  "external_identity",
  "health",
  "health_error",
  "lifecycle",
  "next_attempt_at",
  "next_attempt_after_correction",
  "provider",
  "rate_gate_until",
  "repositories",
];

export function canonicalSystemPollingDeliverySchemas() {
  return {
    SystemPollingDeliveryError: closedObject(
      {
        code: { minLength: 1, type: "string" },
        detail: { minLength: 1, type: "string" },
      },
      ["code", "detail"],
    ),
    SystemGitHubPollingExternalIdentity: closedObject(
      {
        app_id: { minimum: 1, type: "integer" },
        app_slug: { minLength: 1, type: "string" },
        installation_id: { minimum: 1, type: "integer" },
        principal_id: { minimum: 1, type: "integer" },
        principal_login: { minLength: 1, type: "string" },
      },
      [
        "app_id",
        "app_slug",
        "installation_id",
        "principal_id",
        "principal_login",
      ],
    ),
    SystemForgejoPollingExternalIdentity: closedObject(
      {
        base_url: { format: "uri", minLength: 1, type: "string" },
        principal_id: { minimum: 1, type: "integer" },
        principal_login: { minLength: 1, type: "string" },
        reported_version: { minLength: 1, type: "string" },
      },
      ["base_url", "principal_id", "principal_login", "reported_version"],
    ),
    SystemPollingExternalIdentity: {
      oneOf: [
        { $ref: "#/components/schemas/SystemGitHubPollingExternalIdentity" },
        { $ref: "#/components/schemas/SystemForgejoPollingExternalIdentity" },
      ],
    },
    SystemPollingRepositoryFact: closedObject(
      {
        baseline_status: {
          enum: ["pending", "complete", "error"],
          type: "string",
        },
        error: nullableError,
        forge_repository_id: { minimum: 1, type: "integer" },
        health: { enum: ["healthy", "error"], type: "string" },
        health_error: nullableError,
        lifecycle: {
          enum: ["enabled", "disabled", "retired"],
          type: "string",
        },
        last_success_at: nullableTimestamp,
        name: { minLength: 1, type: "string" },
        next_attempt_at: nullableTimestamp,
        next_attempt_after_correction: { type: "boolean" },
        rate_gate_until: nullableTimestamp,
        repository_id: { minLength: 1, type: "string" },
      },
      [
        "baseline_status",
        "error",
        "forge_repository_id",
        "health",
        "health_error",
        "lifecycle",
        "last_success_at",
        "name",
        "next_attempt_at",
        "next_attempt_after_correction",
        "rate_gate_until",
        "repository_id",
      ],
    ),
    SystemGitHubPollingConnectionFact: closedObject(
      {
        ...pollingConnectionProperties,
        external_identity: {
          $ref: "#/components/schemas/SystemGitHubPollingExternalIdentity",
        },
        provider: { const: "github", type: "string" },
      },
      pollingConnectionRequired,
    ),
    SystemForgejoPollingConnectionFact: closedObject(
      {
        ...pollingConnectionProperties,
        external_identity: {
          $ref: "#/components/schemas/SystemForgejoPollingExternalIdentity",
        },
        provider: { const: "forgejo", type: "string" },
      },
      pollingConnectionRequired,
    ),
    SystemPollingConnectionFact: {
      oneOf: [
        { $ref: "#/components/schemas/SystemGitHubPollingConnectionFact" },
        { $ref: "#/components/schemas/SystemForgejoPollingConnectionFact" },
      ],
    },
    SystemPollingFact: closedObject(
      {
        connections: {
          items: {
            $ref: "#/components/schemas/SystemPollingConnectionFact",
          },
          type: "array",
        },
      },
      ["connections"],
    ),
    SystemDeliverySurfaceFact: closedObject(
      {
        adjudication_id: { type: ["string", "null"] },
        attempt_count: { minimum: 0, type: "integer" },
        connection_id: { minLength: 1, type: "string" },
        decision_id: { type: ["string", "null"] },
        definitive: { type: "boolean" },
        error: nullableError,
        evaluation_id: { minLength: 1, type: "string" },
        external_id: { minimum: 1, type: ["integer", "null"] },
        finding_id: { type: ["string", "null"] },
        last_attempt_at: nullableTimestamp,
        next_attempt_at: nullableTimestamp,
        owner_kind: {
          enum: ["evaluation", "adjudication", "decision"],
          type: "string",
        },
        published_at: nullableTimestamp,
        provider: { enum: ["github", "forgejo"], type: "string" },
        provider_gate_error: nullableError,
        provider_gate_until: nullableTimestamp,
        publication_status: {
          enum: ["aggregate_only", "waiting", "succeeded", "unavailable"],
          type: "string",
        },
        reconciliation_required: { type: "boolean" },
        repository_id: { minLength: 1, type: "string" },
        source_identity: { minLength: 1, type: "string" },
        status: {
          enum: [
            "aggregate_only",
            "waiting",
            "retry_scheduled",
            "reconciling",
            "succeeded",
            "unavailable",
          ],
          type: "string",
        },
        surface: {
          enum: ["commit_status", "aggregate_feedback", "inline_feedback"],
          type: "string",
        },
        target: { type: ["string", "null"] },
      },
      [
        "adjudication_id",
        "attempt_count",
        "connection_id",
        "decision_id",
        "definitive",
        "error",
        "evaluation_id",
        "external_id",
        "finding_id",
        "last_attempt_at",
        "next_attempt_at",
        "owner_kind",
        "published_at",
        "provider",
        "provider_gate_error",
        "provider_gate_until",
        "publication_status",
        "reconciliation_required",
        "repository_id",
        "source_identity",
        "status",
        "surface",
        "target",
      ],
    ),
    SystemDeliveryFact: closedObject(
      {
        surfaces: {
          items: {
            $ref: "#/components/schemas/SystemDeliverySurfaceFact",
          },
          type: "array",
        },
      },
      ["surfaces"],
    ),
  };
}
