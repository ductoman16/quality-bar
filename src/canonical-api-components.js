import { canonicalRepositorySchemas } from "./canonical-repository-components.js";
import { canonicalGitHubConnectionSchemas } from "./canonical-github-connection-components.js";
import { closedObject, openObject } from "./canonical-schema.js";
import { canonicalWaiverAdjudicatorConfigurationSchemas } from "./canonical-waiver-adjudicator-configuration-api.js";
import { canonicalStorageReserveSchemas } from "./canonical-storage-reserve-components.js";
import { canonicalEvaluationSchemas } from "./canonical-evaluation-components.js";
import { canonicalCodexExecutionConcurrencySchemas } from "./canonical-codex-execution-concurrency-api.js";
import { canonicalSystemExecutionSchemas } from "./canonical-system-execution-components.js";
import { canonicalSystemFactSchemas } from "./canonical-system-fact-components.js";
import { canonicalSystemPollingDeliverySchemas } from "./canonical-system-polling-delivery-components.js";
import { canonicalSystemStorageSchemas } from "./canonical-system-storage-components.js";
import { canonicalAnalyticsSchemas } from "./canonical-analytics-components.js";

/**
 * @typedef {{
 *   codex_cli_version: string,
 *   models: ReadonlyArray<{
 *     id: string,
 *     reasoning_efforts: ReadonlyArray<string>,
 *     service_tiers: ReadonlyArray<string>
 *   }>
 * }} CodexCapabilityCatalog
 */

/** @param {CodexCapabilityCatalog} codexCapabilityCatalog */
export function createCanonicalComponents(codexCapabilityCatalog) {
  return {
    schemas: {
      AuthorityAttribution: openObject(
        {
          action: { type: "string" },
          channel: {
            enum: [
              "browser_session",
              "host",
              "implementer_token",
              "onboarding_token",
            ],
            type: "string",
          },
          error_code: { type: "string" },
          id: { type: "string" },
          occurred_at: { format: "date-time", type: "string" },
          outcome: {
            enum: ["success", "failure", "forbidden"],
            type: "string",
          },
        },
        ["id", "channel", "action", "outcome", "occurred_at"],
      ),
      AuthorityAttributionCollection: openObject(
        {
          items: {
            items: { $ref: "#/components/schemas/AuthorityAttribution" },
            type: "array",
          },
          next_cursor: { type: ["string", "null"] },
        },
        ["items", "next_cursor"],
      ),
      Error: openObject(
        {
          code: { type: "string" },
          fields: {
            items: { $ref: "#/components/schemas/FieldError" },
            type: "array",
          },
          message: { type: "string" },
          request_id: { type: "string" },
        },
        ["code", "message", "request_id"],
      ),
      FieldError: openObject(
        {
          code: { type: "string" },
          message: { type: "string" },
          path: { type: "string" },
        },
        ["path", "code", "message"],
      ),
      ErrorResponse: openObject(
        { error: { $ref: "#/components/schemas/Error" } },
        ["error"],
      ),
      ...canonicalGitHubConnectionSchemas(),
      ...canonicalCodexExecutionConcurrencySchemas(),
      ...canonicalSystemExecutionSchemas(),
      ...canonicalSystemFactSchemas(codexCapabilityCatalog),
      ...canonicalSystemPollingDeliverySchemas(),
      ...canonicalSystemStorageSchemas(),
      CurrentPasswordRequest: closedObject({ password: { type: "string" } }, [
        "password",
      ]),
      LoginRequest: closedObject({ password: { type: "string" } }, [
        "password",
      ]),
      PasswordChangeRequest: closedObject(
        {
          current_password: { type: "string" },
          new_password: { type: "string" },
        },
        ["current_password", "new_password"],
      ),
      SessionRevocationRequest: closedObject(
        {
          confirmation: { const: "REVOKE ALL SESSIONS", type: "string" },
          password: { type: "string" },
        },
        ["confirmation", "password"],
      ),
      ...canonicalRepositorySchemas(),
      CodexConfiguration: {
        oneOf: codexCapabilityCatalog.models.map((model) =>
          closedObject(
            {
              model: { const: model.id, type: "string" },
              reasoning_effort: {
                enum: model.reasoning_efforts,
                type: "string",
              },
              service_tier: { enum: model.service_tiers, type: "string" },
            },
            ["model", "reasoning_effort", "service_tier"],
          ),
        ),
      },
      ...canonicalWaiverAdjudicatorConfigurationSchemas(),
      CriterionCreateRequest: closedObject(
        {
          impact: { enum: ["advisory", "blocking"], type: "string" },
          instruction: { minLength: 1, pattern: "\\S", type: "string" },
        },
        ["impact", "instruction"],
      ),
      CriterionVersionRequest: {
        oneOf: [
          closedObject(
            {
              id: { minLength: 1, pattern: "\\S", type: "string" },
              impact: { enum: ["advisory", "blocking"], type: "string" },
              instruction: { minLength: 1, pattern: "\\S", type: "string" },
            },
            ["id", "impact", "instruction"],
          ),
          { $ref: "#/components/schemas/CriterionCreateRequest" },
        ],
      },
      ReviewAssignment: {
        oneOf: [
          closedObject(
            { scope: { const: "installation_wide", type: "string" } },
            ["scope"],
          ),
          closedObject(
            {
              repository_ids: {
                items: { minLength: 1, pattern: "\\S", type: "string" },
                type: "array",
                uniqueItems: true,
              },
              scope: { const: "repository_set", type: "string" },
            },
            ["scope", "repository_ids"],
          ),
        ],
      },
      ReviewCreationAssignment: {
        $ref: "#/components/schemas/ReviewAssignment",
      },
      ReviewCreateRequest: closedObject(
        {
          assignment: {
            $ref: "#/components/schemas/ReviewCreationAssignment",
          },
          applicability_rule: { type: ["string", "null"] },
          codex_configuration: {
            $ref: "#/components/schemas/CodexConfiguration",
          },
          criteria: {
            items: { $ref: "#/components/schemas/CriterionCreateRequest" },
            minItems: 1,
            type: "array",
          },
          description: { minLength: 1, pattern: "\\S", type: "string" },
          name: { minLength: 1, pattern: "\\S", type: "string" },
        },
        [
          "assignment",
          "codex_configuration",
          "criteria",
          "description",
          "name",
        ],
      ),
      ReviewMetadataUpdateRequest: closedObject(
        {
          description: { minLength: 1, pattern: "\\S", type: "string" },
          name: { minLength: 1, pattern: "\\S", type: "string" },
        },
        ["name", "description"],
      ),
      EmptyRequest: closedObject({}, []),
      OnboardingTokenCreateRequest: closedObject(
        {
          repository_url: {
            format: "uri",
            pattern: "^https://",
            type: "string",
          },
        },
        ["repository_url"],
      ),
      OnboardingToken: closedObject(
        {
          created_at: { minimum: 0, type: "integer" },
          expires_at: { minimum: 0, type: "integer" },
          id: { minLength: 1, type: "string" },
          repository_url: { format: "uri", type: "string" },
        },
        ["id", "repository_url", "created_at", "expires_at"],
      ),
      OnboardingTokenReveal: closedObject(
        {
          created_at: { minimum: 0, type: "integer" },
          expires_at: { minimum: 0, type: "integer" },
          id: { minLength: 1, type: "string" },
          repository_url: { format: "uri", type: "string" },
          token: { minLength: 43, maxLength: 43, type: "string" },
        },
        ["id", "repository_url", "created_at", "expires_at", "token"],
      ),
      OnboardingRepositoryRegistrationRequest: closedObject(
        {
          url: {
            format: "uri",
            pattern: "^[hH][tT][tT][pP][sS]://",
            type: "string",
          },
        },
        ["url"],
      ),
      OnboardingTokenCollection: closedObject(
        {
          onboarding_tokens: {
            items: { $ref: "#/components/schemas/OnboardingToken" },
            type: "array",
          },
        },
        ["onboarding_tokens"],
      ),
      OnboardingReviewSelectionRequest: closedObject(
        {
          review_ids: {
            items: { minLength: 1, type: "string" },
            type: "array",
            uniqueItems: true,
          },
        },
        ["review_ids"],
      ),
      OnboardingReviewSelectionResult: closedObject(
        {
          added_review_ids: { items: { type: "string" }, type: "array" },
          removed_review_ids: { items: { type: "string" }, type: "array" },
        },
        ["added_review_ids", "removed_review_ids"],
      ),
      OnboardingReviewCreateRequest: closedObject(
        {
          applicability_rule: { type: ["string", "null"] },
          codex_configuration: {
            $ref: "#/components/schemas/CodexConfiguration",
          },
          criteria: {
            items: { $ref: "#/components/schemas/CriterionCreateRequest" },
            minItems: 1,
            type: "array",
          },
          description: { minLength: 1, pattern: "\\S", type: "string" },
          name: { minLength: 1, pattern: "\\S", type: "string" },
        },
        [
          "name",
          "description",
          "codex_configuration",
          "criteria",
          "applicability_rule",
        ],
      ),
      ReviewArchivalRequest: closedObject({ archived: { type: "boolean" } }, [
        "archived",
      ]),
      ReviewVersionSaveRequest: closedObject(
        {
          applicability_rule: { type: ["string", "null"] },
          codex_configuration: {
            $ref: "#/components/schemas/CodexConfiguration",
          },
          criteria: {
            items: { $ref: "#/components/schemas/CriterionVersionRequest" },
            minItems: 1,
            type: "array",
          },
        },
        ["applicability_rule", "codex_configuration", "criteria"],
      ),
      ReviewVersionReactivationRequest: closedObject(
        {
          review_version_id: {
            minLength: 1,
            pattern: "\\S",
            type: "string",
          },
        },
        ["review_version_id"],
      ),
      Criterion: closedObject(
        {
          id: { type: "string" },
          impact: { enum: ["advisory", "blocking"], type: "string" },
          instruction: { type: "string" },
          position: { minimum: 1, type: "integer" },
        },
        ["id", "impact", "instruction", "position"],
      ),
      ReviewVersion: closedObject(
        {
          applicability_rule: { type: ["string", "null"] },
          codex_configuration: {
            $ref: "#/components/schemas/CodexConfiguration",
          },
          criteria: {
            items: { $ref: "#/components/schemas/Criterion" },
            minItems: 1,
            type: "array",
          },
          id: { type: "string" },
          number: { minimum: 1, type: "integer" },
        },
        [
          "id",
          "number",
          "applicability_rule",
          "codex_configuration",
          "criteria",
        ],
      ),
      Review: closedObject(
        {
          active_version: { $ref: "#/components/schemas/ReviewVersion" },
          archived: { type: "boolean" },
          assignment: { $ref: "#/components/schemas/ReviewAssignment" },
          deletion_eligible: { type: "boolean" },
          description: { type: "string" },
          id: { type: "string" },
          name: { type: "string" },
          versions: {
            items: { $ref: "#/components/schemas/ReviewVersion" },
            minItems: 1,
            type: "array",
          },
        },
        [
          "id",
          "name",
          "description",
          "archived",
          "assignment",
          "deletion_eligible",
          "active_version",
          "versions",
        ],
      ),
      ReviewVersionSaveResult: closedObject(
        {
          changed: { type: "boolean" },
          review: { $ref: "#/components/schemas/Review" },
        },
        ["changed", "review"],
      ),
      ReviewVersionReactivationResult: closedObject(
        {
          changed: { type: "boolean" },
          review: { $ref: "#/components/schemas/Review" },
        },
        ["changed", "review"],
      ),
      ReviewArchivalResult: closedObject(
        {
          changed: { type: "boolean" },
          review: { $ref: "#/components/schemas/Review" },
        },
        ["changed", "review"],
      ),
      ReviewAssignmentChangeResult: closedObject(
        {
          changed: { type: "boolean" },
          review: { $ref: "#/components/schemas/Review" },
        },
        ["changed", "review"],
      ),
      ReviewCollection: closedObject(
        {
          reviews: {
            items: { $ref: "#/components/schemas/Review" },
            type: "array",
          },
        },
        ["reviews"],
      ),
      System: openObject(
        {
          application: { $ref: "#/components/schemas/SystemApplicationFact" },
          backup: { $ref: "#/components/schemas/SystemBackupFact" },
          bootstrap: { $ref: "#/components/schemas/BootstrapFact" },
          browser_sessions: {
            $ref: "#/components/schemas/BrowserSessionsFact",
          },
          codex: { $ref: "#/components/schemas/CodexFact" },
          codex_execution: {
            $ref: "#/components/schemas/CodexExecutionSystemFact",
          },
          delivery: { $ref: "#/components/schemas/SystemDeliveryFact" },
          durable_core: { $ref: "#/components/schemas/DurableCoreFact" },
          execution_providers: {
            items: { $ref: "#/components/schemas/ExecutionProviderFact" },
            minItems: 1,
            type: "array",
          },
          implementer_token: {
            $ref: "#/components/schemas/ImplementerTokenFact",
          },
          polling: { $ref: "#/components/schemas/SystemPollingFact" },
          storage: { $ref: "#/components/schemas/StorageReserveFact" },
        },
        [
          "application",
          "backup",
          "bootstrap",
          "browser_sessions",
          "codex",
          "codex_execution",
          "delivery",
          "durable_core",
          "execution_providers",
          "implementer_token",
          "polling",
          "storage",
        ],
      ),
      ...canonicalStorageReserveSchemas(),
      ...canonicalEvaluationSchemas(),
      ...canonicalAnalyticsSchemas(),
    },
    securitySchemes: {
      browser_session: {
        in: "cookie",
        name: "quality_bar_session",
        type: "apiKey",
      },
      implementer_token: { scheme: "bearer", type: "http" },
      onboarding_token: { scheme: "bearer", type: "http" },
    },
  };
}
