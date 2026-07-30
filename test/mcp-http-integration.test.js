import assert from "node:assert/strict";
import { test } from "node:test";

import { createReviewService } from "../src/review.js";
import { startApplication } from "./http-integration-support.js";
import { reviewRequest } from "./review-http-integration-support.js";

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
function requestMessage(method, params, id = 1) {
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

test("authenticated Streamable HTTP MCP initializes without a server session or excluded capabilities", async () => {
  const { application, origin } = await startApplication();
  const token = application.implementerTokens.create(
    "a correct operator password",
  );

  const initialized = await fetch(`${origin}/mcp/v1`, {
    body: JSON.stringify(
      requestMessage("initialize", {
        capabilities: {},
        clientInfo: { name: "quality-bar-test", version: "1.0.0" },
        protocolVersion: MCP_PROTOCOL_VERSION,
      }),
    ),
    headers: mcpHeaders(token),
    method: "POST",
  });

  assert.equal(initialized.status, 200);
  assert.equal(initialized.headers.get("content-type"), "application/json");
  assert.equal(initialized.headers.get("mcp-session-id"), null);
  assert.deepEqual(await initialized.json(), {
    id: 1,
    jsonrpc: "2.0",
    result: {
      capabilities: { resources: {}, tools: {} },
      protocolVersion: MCP_PROTOCOL_VERSION,
      serverInfo: { name: "quality-bar", version: "0.1.0" },
    },
  });

  const negotiated = await fetch(`${origin}/mcp/v1`, {
    body: JSON.stringify(
      requestMessage("initialize", {
        capabilities: {},
        clientInfo: { name: "quality-bar-test", version: "1.0.0" },
        protocolVersion: "2025-06-18",
      }),
    ),
    headers: mcpHeaders(token, {
      accept: "application/json; q=1, text/event-stream; q=0.5",
    }),
    method: "POST",
  });
  assert.equal(negotiated.status, 200);
  assert.equal(
    /** @type {any} */ (await negotiated.json()).result.protocolVersion,
    MCP_PROTOCOL_VERSION,
  );

  for (const method of ["GET", "DELETE"]) {
    const unsupported = await fetch(`${origin}/mcp/v1`, {
      headers: mcpHeaders(token, {
        "mcp-protocol-version": MCP_PROTOCOL_VERSION,
      }),
      method,
    });
    assert.equal(unsupported.status, 405, method);
    assert.equal(unsupported.headers.get("allow"), "POST");
  }
});

test("MCP exposes only the fixed Repository, Evaluation, and waiver tools and resource templates", async () => {
  const { application, origin } = await startApplication();
  const token = application.implementerTokens.create(
    "a correct operator password",
  );
  const headers = mcpHeaders(token, {
    "mcp-protocol-version": MCP_PROTOCOL_VERSION,
  });

  const toolResponse = await fetch(`${origin}/mcp/v1`, {
    body: JSON.stringify(requestMessage("tools/list", {}, 2)),
    headers,
    method: "POST",
  });
  assert.equal(toolResponse.status, 200);
  const toolBody = /** @type {any} */ (await toolResponse.json());
  assert.deepEqual(
    toolBody.result.tools.map((/** @type {{name: string}} */ { name }) => name),
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
    toolBody.result.tools.map(
      (/** @type {{inputSchema: {$schema: string}}} */ { inputSchema }) =>
        inputSchema.$schema,
    ),
    Array(7).fill("https://json-schema.org/draft/2020-12/schema"),
  );
  assert.deepEqual(
    toolBody.result.tools.map(
      (
        /** @type {{inputSchema: {additionalProperties: boolean}}} */ {
          inputSchema,
        },
      ) => inputSchema.additionalProperties,
    ),
    Array(7).fill(false),
  );

  const templatesResponse = await fetch(`${origin}/mcp/v1`, {
    body: JSON.stringify(requestMessage("resources/templates/list", {}, 3)),
    headers,
    method: "POST",
  });
  assert.equal(templatesResponse.status, 200);
  const templatesBody = /** @type {any} */ (await templatesResponse.json());
  assert.deepEqual(
    templatesBody.result.resourceTemplates.map(
      (
        /** @type {{mimeType: string, uriTemplate: string}} */ {
          mimeType,
          uriTemplate,
        },
      ) => ({ mimeType, uriTemplate }),
    ),
    [
      {
        mimeType: "application/json",
        uriTemplate: "quality-bar://v1/repositories/{repository_id}",
      },
      {
        mimeType: "application/json",
        uriTemplate: "quality-bar://v1/repositories/{repository_id}/guidance",
      },
      {
        mimeType: "application/json",
        uriTemplate: "quality-bar://v1/evaluations/{evaluation_id}",
      },
      {
        mimeType: "application/json",
        uriTemplate: "quality-bar://v1/evaluations/{evaluation_id}/result",
      },
      {
        mimeType: "application/json",
        uriTemplate: "quality-bar://v1/review-runs/{review_run_id}",
      },
      {
        mimeType: "application/json",
        uriTemplate: "quality-bar://v1/findings/{finding_id}",
      },
      {
        mimeType: "application/json",
        uriTemplate: "quality-bar://v1/waiver-requests/{waiver_request_id}",
      },
      {
        mimeType: "application/json",
        uriTemplate:
          "quality-bar://v1/waiver-adjudications/{waiver_adjudication_id}",
      },
      {
        mimeType: "application/json",
        uriTemplate: "quality-bar://v1/waiver-decisions/{waiver_decision_id}",
      },
    ],
  );

  const resourcesResponse = await fetch(`${origin}/mcp/v1`, {
    body: JSON.stringify(requestMessage("resources/list", {}, 4)),
    headers,
    method: "POST",
  });
  assert.equal(resourcesResponse.status, 200);
  assert.deepEqual(await resourcesResponse.json(), {
    id: 4,
    jsonrpc: "2.0",
    result: { resources: [] },
  });
});

test("MCP tools and resources return the canonical Repository and Guidance documents", async () => {
  const { application, origin, request } = await startApplication();
  application.durableCore.run(
    "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES (?, ?, ?, ?)",
    "repository/one",
    "https://example.com/one.git",
    1,
    1,
  );
  application.durableCore.run(
    "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES (?, ?, ?, ?)",
    "repository/two",
    "https://example.com/two.git",
    2,
    2,
  );
  const reviews = createReviewService(application.durableCore, {
    createId: (() => {
      let next = 0;
      return () => `mcp-guidance-${++next}`;
    })(),
    now: () => 3,
  });
  reviews.create(
    reviewRequest({
      description: "Keep MCP and HTTP documents equivalent.",
      name: "MCP equivalence",
    }),
  );
  const token = application.implementerTokens.create(
    "a correct operator password",
  );
  const headers = mcpHeaders(token, {
    "mcp-protocol-version": MCP_PROTOCOL_VERSION,
  });

  const httpList = await request("/api/v1/repositories?limit=1", {
    headers: { authorization: `Bearer ${token}` },
  });
  const httpListDocument = /** @type {any} */ (await httpList.json());
  const listed = await callMcp(
    origin,
    headers,
    requestMessage(
      "tools/call",
      {
        arguments: { limit: 1 },
        name: "quality_bar.list_repositories",
      },
      5,
    ),
  );
  assert.equal(listed.result.isError, false);
  assert.deepEqual(
    {
      items: listed.result.structuredContent.items,
      repositories: listed.result.structuredContent.repositories,
    },
    {
      items: httpListDocument.items,
      repositories: httpListDocument.repositories,
    },
  );
  assert.equal(typeof httpListDocument.next_cursor, "string");
  assert.equal(typeof listed.result.structuredContent.next_cursor, "string");
  assert.deepEqual(
    JSON.parse(listed.result.content[0].text),
    listed.result.structuredContent,
  );
  assert.deepEqual(listed.result.content.slice(1), [
    {
      mimeType: "application/json",
      name: "repository/one",
      type: "resource_link",
      uri: "quality-bar://v1/repositories/repository%2Fone",
    },
  ]);

  const nextPage = await callMcp(
    origin,
    headers,
    requestMessage(
      "tools/call",
      {
        arguments: {
          cursor: listed.result.structuredContent.next_cursor,
          limit: 1,
        },
        name: "quality_bar.list_repositories",
      },
      10,
    ),
  );
  assert.deepEqual(
    nextPage.result.structuredContent.items.map(
      (/** @type {{id: string}} */ { id }) => id,
    ),
    ["repository/two"],
  );

  const located = await callMcp(
    origin,
    headers,
    requestMessage(
      "tools/call",
      {
        arguments: { remote_url: "https://example.com/two.git" },
        name: "quality_bar.list_repositories",
      },
      6,
    ),
  );
  assert.deepEqual(
    located.result.structuredContent.items.map(
      (/** @type {{id: string}} */ { id }) => id,
    ),
    ["repository/two"],
  );
  assert.equal(located.result.structuredContent.next_cursor, null);

  const httpGuidance = await request(
    "/api/v1/repositories/repository%2Fone/guidance",
    { headers: { authorization: `Bearer ${token}` } },
  );
  const guidanceDocument = await httpGuidance.json();
  const guidance = await callMcp(
    origin,
    headers,
    requestMessage(
      "tools/call",
      {
        arguments: { repository_id: "repository/one" },
        name: "quality_bar.get_repository_guidance",
      },
      7,
    ),
  );
  assert.equal(guidance.result.isError, false);
  assert.deepEqual(guidance.result.structuredContent, guidanceDocument);
  assert.doesNotMatch(
    JSON.stringify(guidance.result),
    /codex_configuration|applicability_result/,
  );

  for (const [id, uri, expected] of [
    [
      8,
      "quality-bar://v1/repositories/repository%2Fone",
      httpListDocument.items[0],
    ],
    [
      9,
      "quality-bar://v1/repositories/repository%2Fone/guidance",
      guidanceDocument,
    ],
  ]) {
    const resource = await callMcp(
      origin,
      headers,
      requestMessage("resources/read", { uri }, id),
    );
    assert.deepEqual(JSON.parse(resource.result.contents[0].text), expected);
    assert.equal(resource.result.contents[0].mimeType, "application/json");
    assert.equal(resource.result.contents[0].uri, uri);
  }
});
