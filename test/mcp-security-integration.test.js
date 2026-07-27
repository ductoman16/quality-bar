import assert from "node:assert/strict";
import { test } from "node:test";

import { createUnavailableRepositoryGuidanceService } from "../src/repository-guidance.js";
import { startApplication } from "./http-integration-support.js";

const MCP_PROTOCOL_VERSION = "2025-11-25";

/** @param {string} token @param {Record<string, string>} [headers] */
function mcpHeaders(token, headers = {}) {
  return {
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    ...headers,
  };
}

/** @param {string} method @param {unknown} params @param {number} id */
function requestMessage(method, params, id) {
  return { id, jsonrpc: "2.0", method, params };
}

/**
 * @param {string} origin
 * @param {Record<string, string>} headers
 * @param {unknown} message
 */
async function callMcp(origin, headers, message) {
  const response = await fetch(`${origin}/mcp/v1`, {
    body: JSON.stringify(message),
    headers,
    method: "POST",
  });
  assert.equal(response.status, 200);
  return /** @type {any} */ (await response.json());
}

test("MCP rejects excluded capabilities and surfaces exact owning errors without fallback results", async () => {
  const { application, origin } = await startApplication();
  const token = application.implementerTokens.create(
    "a correct operator password",
  );
  const headers = mcpHeaders(token, {
    "mcp-protocol-version": MCP_PROTOCOL_VERSION,
  });

  const initialized = await fetch(`${origin}/mcp/v1`, {
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }),
    headers,
    method: "POST",
  });
  assert.equal(initialized.status, 202);
  assert.equal(await initialized.text(), "");

  const ignoredNotification = await fetch(`${origin}/mcp/v1`, {
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/roots/list_changed",
    }),
    headers,
    method: "POST",
  });
  assert.equal(ignoredNotification.status, 202);
  assert.equal(await ignoredNotification.text(), "");

  const ping = await callMcp(origin, headers, requestMessage("ping", {}, 10));
  assert.deepEqual(ping.result, {});

  for (const [id, method] of /** @type {Array<[number, string]>} */ ([
    [11, "prompts/list"],
    [12, "completion/complete"],
    [13, "logging/setLevel"],
    [14, "roots/list"],
    [15, "tasks/list"],
  ])) {
    const excluded = await callMcp(
      origin,
      headers,
      requestMessage(method, {}, id),
    );
    assert.deepEqual(excluded.error, {
      code: -32601,
      message: "Method not found",
    });
    assert.equal("result" in excluded, false);
  }

  const malformed = await callMcp(
    origin,
    headers,
    requestMessage(
      "tools/call",
      {
        arguments: { limit: 1, unexpected: true },
        name: "quality_bar.list_repositories",
      },
      16,
    ),
  );
  assert.equal(malformed.result.isError, true);
  assert.equal(
    malformed.result.structuredContent.error.code,
    "request_malformed",
  );
  assert.equal(
    malformed.result.structuredContent.error.message,
    "Request is malformed",
  );
  assert.equal(
    typeof malformed.result.structuredContent.error.request_id,
    "string",
  );
  assert.equal("items" in malformed.result.structuredContent, false);

  const missingGuidance = await callMcp(
    origin,
    headers,
    requestMessage(
      "tools/call",
      {
        arguments: { repository_id: "repository/missing" },
        name: "quality_bar.get_repository_guidance",
      },
      17,
    ),
  );
  assert.equal(missingGuidance.result.isError, true);
  assert.equal(
    missingGuidance.result.structuredContent.error.code,
    "repository_not_found",
  );
  assert.equal("repository" in missingGuidance.result.structuredContent, false);
  assert.equal("reviews" in missingGuidance.result.structuredContent, false);

  const missingResource = await callMcp(
    origin,
    headers,
    requestMessage(
      "resources/read",
      {
        uri: "quality-bar://v1/repositories/repository%2Fmissing/guidance",
      },
      18,
    ),
  );
  assert.equal(missingResource.error.code, -32002);
  assert.equal(missingResource.error.data.error.code, "repository_not_found");
  assert.equal("result" in missingResource, false);

  for (const [body, code] of /** @type {Array<[string, number]>} */ ([
    ["{", -32700],
    ["[]", -32600],
  ])) {
    const invalid = await fetch(`${origin}/mcp/v1`, {
      body,
      headers,
      method: "POST",
    });
    assert.equal(invalid.status, 200);
    assert.equal(/** @type {any} */ (await invalid.json()).error.code, code);
  }
});

test("MCP requires the implementer bearer, exact protocol header, and valid Origin", async () => {
  const { application, origin, request } = await startApplication();
  const token = application.implementerTokens.create(
    "a correct operator password",
  );
  const message = requestMessage("tools/list", {}, 19);

  const missingBearer = await fetch(`${origin}/mcp/v1`, {
    body: JSON.stringify(message),
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": MCP_PROTOCOL_VERSION,
    },
    method: "POST",
  });
  assert.equal(missingBearer.status, 401);
  assert.equal(
    /** @type {any} */ (await missingBearer.json()).error.code,
    "authentication_invalid",
  );

  const login = await request("/api/v1/session/login", {
    body: JSON.stringify({ password: "a correct operator password" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(cookie);
  const browserCredential = await fetch(`${origin}/mcp/v1`, {
    body: JSON.stringify(message),
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      cookie,
      "mcp-protocol-version": MCP_PROTOCOL_VERSION,
    },
    method: "POST",
  });
  assert.equal(browserCredential.status, 401);
  assert.equal(
    /** @type {any} */ (await browserCredential.json()).error.code,
    "authentication_invalid",
  );

  for (const protocolVersion of [undefined, "2025-06-18"]) {
    const headers = mcpHeaders(
      token,
      protocolVersion === undefined
        ? {}
        : { "mcp-protocol-version": protocolVersion },
    );
    const protocolFailure = await fetch(`${origin}/mcp/v1`, {
      body: JSON.stringify(message),
      headers,
      method: "POST",
    });
    assert.equal(protocolFailure.status, 400);
    const document = /** @type {any} */ (await protocolFailure.json());
    assert.deepEqual(document.error, {
      code: -32600,
      message: "Invalid Request",
    });
    assert.equal("result" in document, false);
  }

  const invalidOrigin = await fetch(`${origin}/mcp/v1`, {
    body: JSON.stringify(message),
    headers: mcpHeaders(token, {
      "mcp-protocol-version": MCP_PROTOCOL_VERSION,
      origin: "https://attacker.example",
    }),
    method: "POST",
  });
  assert.equal(invalidOrigin.status, 403);
  assert.equal(
    /** @type {any} */ (await invalidOrigin.json()).error.code,
    "origin_invalid",
  );
});

test("MCP records only secret-safe operation identity, resources, duration, and outcome", async () => {
  /** @type {string[]} */
  const logs = [];
  const { application, origin } = await startApplication({
    writeLog(line) {
      logs.push(line);
    },
  });
  const token = application.implementerTokens.create(
    "a correct operator password",
  );
  const headers = mcpHeaders(token, {
    "mcp-protocol-version": MCP_PROTOCOL_VERSION,
  });

  const failed = await callMcp(
    origin,
    headers,
    requestMessage(
      "tools/call",
      {
        arguments: {
          remote_url:
            "https://sensitive-user:sensitive-token@example.com/private.git",
        },
        name: "quality_bar.list_repositories",
      },
      20,
    ),
  );
  assert.equal(
    failed.result.structuredContent.error.code,
    "repository_credentials_unsupported",
  );

  const records = logs
    .map((line) => JSON.parse(line))
    .filter(({ event }) => event === "mcp_request");
  assert.equal(records.length, 1);
  assert.deepEqual(records[0], {
    component: "mcp",
    duration_ms: records[0].duration_ms,
    error: "repository_credentials_unsupported",
    event: "mcp_request",
    operation: "quality_bar.list_repositories",
    outcome: "failure",
    request_id: "20",
    resource_ids: [],
    severity: "error",
    timestamp: records[0].timestamp,
  });
  assert.equal(Number.isInteger(records[0].duration_ms), true);
  assert.match(records[0].timestamp, /^\d{4}-\d{2}-\d{2}T/);
  assert.doesNotMatch(
    JSON.stringify(records),
    /sensitive-user|sensitive-token|authorization|remote_url/,
  );
});

test("MCP surfaces exact Repository Guidance unavailability without a partial or stale document", async () => {
  const unavailable = Object.assign(
    new Error("Repository Guidance is unavailable"),
    { code: "repository_guidance_unavailable" },
  );
  const { application, origin } = await startApplication({
    createRepositoryGuidance() {
      return createUnavailableRepositoryGuidanceService(unavailable);
    },
  });
  const token = application.implementerTokens.create(
    "a correct operator password",
  );
  const response = await callMcp(
    origin,
    mcpHeaders(token, {
      "mcp-protocol-version": MCP_PROTOCOL_VERSION,
    }),
    requestMessage(
      "tools/call",
      {
        arguments: { repository_id: "repository/one" },
        name: "quality_bar.get_repository_guidance",
      },
      21,
    ),
  );

  assert.equal(response.result.isError, true);
  assert.deepEqual(
    {
      code: response.result.structuredContent.error.code,
      message: response.result.structuredContent.error.message,
    },
    {
      code: "repository_guidance_unavailable",
      message: "Repository Guidance is unavailable",
    },
  );
  assert.equal("repository" in response.result.structuredContent, false);
  assert.equal("reviews" in response.result.structuredContent, false);
});
