import { canonicalRepositorySchemas } from "./canonical-repository-components.js";
import { canonicalGitHubConnectionSchemas } from "./canonical-github-connection-components.js";
import { closedObject, openObject } from "./canonical-schema.js";
import { canonicalWaiverAdjudicatorConfigurationSchemas } from "./canonical-waiver-adjudicator-configuration-components.js";
import { canonicalStorageReserveSchemas } from "./canonical-storage-reserve-components.js";
import { canonicalEvaluationSchemas } from "./canonical-evaluation-components.js";
import { canonicalCodexExecutionConcurrencySchemas } from "./canonical-codex-execution-concurrency-components.js";
import { canonicalSystemExecutionSchemas } from "./canonical-system-execution-components.js";
import { canonicalSystemFactSchemas } from "./canonical-system-fact-components.js";
import { canonicalSystemPollingDeliverySchemas } from "./canonical-system-polling-delivery-components.js";
import { canonicalSystemStorageSchemas } from "./canonical-system-storage-components.js";
import { canonicalAnalyticsSchemas } from "./canonical-analytics-components.js";
import { canonicalReviewSchemas } from "./canonical-review-components.js";

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
            items: { $ref: "AuthorityAttribution#" },
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
            items: { $ref: "FieldError#" },
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
      ErrorResponse: {
        ...openObject({ error: { $ref: "Error#" } }, ["error"]),
        description: "A secret-safe canonical error",
      },
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
      ...canonicalReviewSchemas(),
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
            items: { $ref: "OnboardingToken#" },
            type: "array",
          },
        },
        ["onboarding_tokens"],
      ),
      System: openObject(
        {
          application: { $ref: "SystemApplicationFact#" },
          backup: { $ref: "SystemBackupFact#" },
          bootstrap: { $ref: "BootstrapFact#" },
          browser_sessions: {
            $ref: "BrowserSessionsFact#",
          },
          codex: { $ref: "CodexFact#" },
          codex_execution: {
            $ref: "CodexExecutionSystemFact#",
          },
          delivery: { $ref: "SystemDeliveryFact#" },
          durable_core: { $ref: "DurableCoreFact#" },
          execution_providers: {
            items: { $ref: "ExecutionProviderFact#" },
            minItems: 1,
            type: "array",
          },
          implementer_token: {
            $ref: "ImplementerTokenFact#",
          },
          polling: { $ref: "SystemPollingFact#" },
          storage: { $ref: "StorageReserveFact#" },
          migration: { $ref: "SystemMigrationFact#" },
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
          "migration",
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
