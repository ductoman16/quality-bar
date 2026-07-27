export const MCP_PROTOCOL_VERSION = "2025-11-25";
export const MCP_SERVER_VERSION = "0.1.0";
const JSON_SCHEMA_2020_12 = "https://json-schema.org/draft/2020-12/schema";

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
]);

export function mcpInitializeResult() {
  return {
    capabilities: { resources: {}, tools: {} },
    protocolVersion: MCP_PROTOCOL_VERSION,
    serverInfo: { name: "quality-bar", version: MCP_SERVER_VERSION },
  };
}
