import { closedObject, openObject } from "./canonical-schema.js";

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
export function canonicalSystemFactSchemas(codexCapabilityCatalog) {
  return {
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
  };
}
