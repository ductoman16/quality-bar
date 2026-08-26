import assert from "node:assert/strict";
import { test } from "node:test";

import { startApplication } from "./http-integration-support.ts";

const MCP_PROTOCOL_VERSION = "2025-11-25";

test("MCP exposes the same URL-bound onboarding authority without waiver access", async () => {
  const { application, origin } = await startApplication();
  const targetUrl = "https://example.com/mcp-target.git";
  const token = application.onboardingTokens.create({
    repository_url: targetUrl,
  }).token;
  application.durableCore.run(
    "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES (?, ?, ?, ?)",
    "mcp-target",
    targetUrl,
    1,
    1,
  );
  application.durableCore.run(
    "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES (?, ?, ?, ?)",
    "mcp-other",
    "https://example.com/mcp-other.git",
    1,
    1,
  );
  const headers = {
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "mcp-protocol-version": MCP_PROTOCOL_VERSION,
  };
  const call = async (method: string, params: unknown, id: number) => {
    const response = await fetch(`${origin}/mcp/v1`, {
      body: JSON.stringify({ id, jsonrpc: "2.0", method, params }),
      headers,
      method: "POST",
    });
    assert.equal(response.status, 200);
    return (await response.json()) as any;
  };

  const listed = await call("tools/list", {}, 1);
  const names = listed.result.tools.map(({ name }: { name: string }) => name);
  assert.ok(names.includes("quality_bar.set_repository_reviews"));
  assert.ok(names.includes("quality_bar.revoke_onboarding_token"));
  assert.equal(names.includes("quality_bar.submit_waiver_requests"), false);

  const repositories = await call(
    "tools/call",
    { arguments: {}, name: "quality_bar.list_repositories" },
    2,
  );
  assert.deepEqual(Object.keys(repositories.result.structuredContent).sort(), [
    "items",
    "next_cursor",
  ]);
  assert.deepEqual(
    repositories.result.structuredContent.items.map(
      ({ id }: { id: string }) => id,
    ),
    ["mcp-target"],
  );
  assert.equal(repositories.result.structuredContent.next_cursor, null);

  const forbidden = await call(
    "tools/call",
    { arguments: {}, name: "quality_bar.submit_waiver_requests" },
    3,
  );
  assert.equal(forbidden.error.code, -32602);
});
