/**
 * @typedef {Record<string, unknown>} JsonSchema
 * @typedef {Record<string, JsonSchema>} JsonSchemaProperties
 * @typedef {{
 *   codex_cli_version: string,
 *   models: ReadonlyArray<{
 *     id: string,
 *     reasoning_efforts: ReadonlyArray<string>,
 *     service_tiers: ReadonlyArray<string>
 *   }>
 * }} CodexCapabilityCatalog
 */

/**
 * @param {JsonSchemaProperties} properties
 * @param {string[]} required
 * @param {boolean} additionalProperties
 */
function objectSchema(properties, required, additionalProperties) {
  return { additionalProperties, properties, required, type: "object" };
}

/**
 * @param {JsonSchemaProperties} properties
 * @param {string[]} required
 */
function openObject(properties, required) {
  return objectSchema(properties, required, true);
}

/**
 * @param {JsonSchemaProperties} properties
 * @param {string[]} required
 */
function closedObject(properties, required) {
  return objectSchema(properties, required, false);
}

/** @param {CodexCapabilityCatalog} codexCapabilityCatalog */
export function createCanonicalComponents(codexCapabilityCatalog) {
  return {
    schemas: {
      AuthorityAttribution: openObject(
        {
          action: { type: "string" },
          channel: {
            enum: ["browser_session", "implementer_token"],
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
      CriterionCreateRequest: closedObject(
        {
          impact: { enum: ["advisory", "blocking"], type: "string" },
          instruction: { minLength: 1, pattern: "\\S", type: "string" },
        },
        ["impact", "instruction"],
      ),
      CriterionVersionRequest: closedObject(
        {
          id: { minLength: 1, pattern: "\\S", type: "string" },
          impact: { enum: ["advisory", "blocking"], type: "string" },
          instruction: { minLength: 1, pattern: "\\S", type: "string" },
        },
        ["id", "impact", "instruction"],
      ),
      ReviewAssignment: closedObject(
        { scope: { const: "installation_wide", type: "string" } },
        ["scope"],
      ),
      ReviewCreateRequest: closedObject(
        {
          assignment: { $ref: "#/components/schemas/ReviewAssignment" },
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
          assignment: { $ref: "#/components/schemas/ReviewAssignment" },
          description: { type: "string" },
          id: { type: "string" },
          name: { type: "string" },
        },
        ["id", "name", "description", "assignment", "active_version"],
      ),
      ReviewVersionSaveResult: closedObject(
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
        },
        [
          "bootstrap",
          "browser_sessions",
          "codex",
          "durable_core",
          "implementer_token",
        ],
      ),
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
