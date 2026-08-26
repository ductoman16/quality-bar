import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MCP_PROTOCOL_VERSION,
  MCP_RESOURCE_TEMPLATES,
  MCP_TOOLS,
  mcpInitializeResult,
} from "../src/mcp/mcp-contract.ts";

test("the fixed MCP contract pins Repository, Evaluation, and waiver tools and resources", () => {
  assert.equal(MCP_PROTOCOL_VERSION, "2025-11-25");
  assert.deepEqual(mcpInitializeResult(), {
    capabilities: { resources: {}, tools: {} },
    protocolVersion: "2025-11-25",
    serverInfo: { name: "quality-bar", version: "0.1.0" },
  });
  assert.deepEqual(
    MCP_TOOLS.map(({ name }) => name),
    [
      "quality_bar.list_repositories",
      "quality_bar.get_repository_guidance",
      "quality_bar.request_evaluation",
      "quality_bar.get_evaluation",
      "quality_bar.get_evaluation_result",
      "quality_bar.submit_waiver_requests",
      "quality_bar.get_waiver_adjudication",
    ],
  );
  assert.deepEqual(
    MCP_TOOLS.find(({ name }) => name === "quality_bar.request_evaluation")
      ?.inputSchema.properties?.idempotency_key,
    {
      maxLength: 255,
      minLength: 1,
      pattern: "^[!-~]+$",
      type: "string",
    },
  );
  assert.deepEqual(
    MCP_TOOLS.find(({ name }) => name === "quality_bar.submit_waiver_requests")
      ?.inputSchema.required,
    ["evaluation_id", "requests", "idempotency_key"],
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
      "quality-bar://v1/evaluations/{evaluation_id}",
      "quality-bar://v1/evaluations/{evaluation_id}/result",
      "quality-bar://v1/review-runs/{review_run_id}",
      "quality-bar://v1/findings/{finding_id}",
      "quality-bar://v1/waiver-requests/{waiver_request_id}",
      "quality-bar://v1/waiver-adjudications/{waiver_adjudication_id}",
      "quality-bar://v1/waiver-decisions/{waiver_decision_id}",
    ],
  );
});
