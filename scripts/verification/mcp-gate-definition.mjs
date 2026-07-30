export const MCP_GATE_DEFINITION = Object.freeze({
  name: "mcp-integration",
  testGroup:
    "authenticated-streamable-http-mcp-repository-guidance-evaluation-waiver-resource-idempotency-and-security-boundary",
  failureCode: "mcp_integration_tests_failed",
  arguments: [
    "--test",
    "test/mcp-evaluation-integration.test.js",
    "test/mcp-http-integration.test.js",
    "test/mcp-security-integration.test.js",
    "test/mcp-waiver-integration.test.js",
  ],
});
