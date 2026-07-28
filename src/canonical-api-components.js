import { canonicalRepositorySchemas } from "./canonical-repository-components.js";
import { canonicalGitHubConnectionSchemas } from "./canonical-github-connection-components.js";
import { closedObject, openObject } from "./canonical-schema.js";
import { canonicalWaiverAdjudicatorConfigurationSchemas } from "./canonical-waiver-adjudicator-configuration-api.js";
import { canonicalStorageReserveSchemas } from "./canonical-storage-reserve-components.js";

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
            enum: ["browser_session", "host", "implementer_token"],
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
                minItems: 1,
                type: "array",
                uniqueItems: true,
              },
              scope: { const: "repository_set", type: "string" },
            },
            ["scope", "repository_ids"],
          ),
        ],
      },
      ReviewCreationAssignment: closedObject(
        { scope: { const: "installation_wide", type: "string" } },
        ["scope"],
      ),
      ReviewCreateRequest: closedObject(
        {
          assignment: {
            $ref: "#/components/schemas/ReviewCreationAssignment",
          },
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
          bootstrap: { $ref: "#/components/schemas/BootstrapFact" },
          browser_sessions: {
            $ref: "#/components/schemas/BrowserSessionsFact",
          },
          codex: { $ref: "#/components/schemas/CodexFact" },
          durable_core: { $ref: "#/components/schemas/DurableCoreFact" },
          implementer_token: {
            $ref: "#/components/schemas/ImplementerTokenFact",
          },
          storage: { $ref: "#/components/schemas/StorageReserveFact" },
        },
        [
          "bootstrap",
          "browser_sessions",
          "codex",
          "durable_core",
          "implementer_token",
          "storage",
        ],
      ),
      ...canonicalStorageReserveSchemas(),
      BootstrapFact: openObject(
        { status: { enum: ["complete", "required"], type: "string" } },
        ["status"],
      ),
      BrowserSessionsFact: openObject(
        {
          active_count: { minimum: 0, type: "integer" },
          status: { const: "available", type: "string" },
        },
        ["active_count", "status"],
      ),
      CodexFact: openObject(
        {
          catalog: { $ref: "#/components/schemas/CodexCapabilityCatalog" },
          error: { type: "string" },
          status: { enum: ["available", "unavailable"], type: "string" },
        },
        ["catalog", "status"],
      ),
      CodexCapabilityCatalog: {
        ...closedObject(
          {
            codex_cli_version: {
              const: codexCapabilityCatalog.codex_cli_version,
              type: "string",
            },
            models: {
              items: { $ref: "#/components/schemas/CodexModelCapability" },
              minItems: 1,
              type: "array",
            },
          },
          ["codex_cli_version", "models"],
        ),
        const: codexCapabilityCatalog,
      },
      CodexModelCapability: {
        oneOf: codexCapabilityCatalog.models.map((model) =>
          closedObject(
            {
              id: { const: model.id, type: "string" },
              reasoning_efforts: {
                items: { enum: model.reasoning_efforts, type: "string" },
                minItems: 1,
                type: "array",
              },
              service_tiers: {
                items: { enum: model.service_tiers, type: "string" },
                minItems: 1,
                type: "array",
              },
            },
            ["id", "reasoning_efforts", "service_tiers"],
          ),
        ),
      },
      DurableCoreFact: openObject(
        {
          schema_version: { minimum: 1, type: "integer" },
          status: { const: "ready", type: "string" },
        },
        ["schema_version", "status"],
      ),
      ImplementerTokenFact: openObject(
        { status: { enum: ["active", "revoked"], type: "string" } },
        ["status"],
      ),
    },
    securitySchemes: {
      browser_session: {
        in: "cookie",
        name: "quality_bar_session",
        type: "apiKey",
      },
      implementer_token: { scheme: "bearer", type: "http" },
    },
  };
}
