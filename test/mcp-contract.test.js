import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MCP_PROTOCOL_VERSION,
  MCP_RESOURCE_TEMPLATES,
  MCP_TOOLS,
  mcpInitializeResult,
} from "../src/mcp-contract.js";

test("the fixed MCP contract pins only stateless Repository tools and resources", () => {
  assert.equal(MCP_PROTOCOL_VERSION, "2025-11-25");
  assert.deepEqual(mcpInitializeResult(), {
    capabilities: { resources: {}, tools: {} },
    protocolVersion: "2025-11-25",
    serverInfo: { name: "quality-bar", version: "0.1.0" },
  });
  assert.deepEqual(
    MCP_TOOLS.map(({ name }) => name),
    ["quality_bar.list_repositories", "quality_bar.get_repository_guidance"],
  );
  for (const tool of MCP_TOOLS) {
    assert.equal(
      tool.inputSchema.$schema,
      "https://json-schema.org/draft/2020-12/schema",
    );
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.doesNotMatch(
      JSON.stringify(tool),
      /model|sampling|elicitation|taskSupport|notification|subscription/,
    );
  }
  assert.deepEqual(
    MCP_RESOURCE_TEMPLATES.map(({ uriTemplate }) => uriTemplate),
    [
      "quality-bar://v1/repositories/{repository_id}",
      "quality-bar://v1/repositories/{repository_id}/guidance",
    ],
  );
});
