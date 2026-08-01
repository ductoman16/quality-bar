import assert from "node:assert/strict";
import { test } from "node:test";

import { CODEX_CAPABILITY_CATALOG } from "../src/codex-capabilities.js";
import { bootstrapOperatorPassword } from "../src/operator-password.js";
import {
  startApplication,
  temporaryDatabasePath,
} from "./browser-session-security-integration-support.js";
import { availableStorageReserve } from "./storage-reserve-support.js";

/**
 * @typedef {{
 *   $ref?: string,
 *   additionalProperties?: boolean,
 *   const?: unknown,
 *   enum?: unknown[],
 *   format?: string,
 *   items?: OpenApiSchema,
 *   minItems?: number,
 *   oneOf: OpenApiSchema[],
 *   pattern?: string,
 *   properties: Record<string, OpenApiSchema>,
 *   required?: string[],
 *   type?: string,
 * }} OpenApiSchema
 */
/**
 * @typedef {{
 *   operationId?: string,
 *   parameters: {name: string, required: boolean}[],
 *   responses: Record<string, {description?: string}>,
 *   security?: Record<string, unknown[]>[],
 * }} OpenApiOperation
 */
/**
 * @typedef {{
 *   openapi: string,
 *   components: {schemas: Record<string, OpenApiSchema>},
 *   paths: Record<string, {get: OpenApiOperation, patch: OpenApiOperation, post: OpenApiOperation}>,
 * }} OpenApiDocument
 */

/** @param {Response} response */
async function responseErrorCode(response) {
  const body = /** @type {{error: {code: string}}} */ (await response.json());
  return body.error.code;
}

/** @param {Response} response */
function responseCookie(response) {
  const cookie = response.headers.get("set-cookie");
  if (!cookie) {
    throw new Error("security_integration_cookie_missing");
  }
  return cookie;
}

test("the authenticated canonical contract is OpenAPI 3.1 with strict System attribution pagination", async () => {
  let now = Date.parse("2026-07-25T12:00:00.000Z");
  const application = await startApplication(temporaryDatabasePath(), {
    now: () => now,
  });
  const password = "a correct operator password";
  bootstrapOperatorPassword(application.application.durableCore, password);

  const unauthenticated = await fetch(
    `${application.origin}/api/v1/openapi.json`,
  );
  assert.equal(unauthenticated.status, 401);
  const unauthenticatedError = /** @type {{error: Record<string, unknown>}} */ (
    await unauthenticated.json()
  );
  assert.deepEqual(Object.keys(unauthenticatedError.error).sort(), [
    "code",
    "message",
    "request_id",
  ]);

  now += 1_000;
  const login = await fetch(`${application.origin}/api/v1/session/login`, {
    body: JSON.stringify({ password }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const setCookie = responseCookie(login);
  const cookie = setCookie.split(";", 1)[0];
  const token = application.application.implementerTokens.create(password);

  const openapi = await fetch(`${application.origin}/api/v1/openapi.json`, {
    headers: { cookie },
  });
  assert.equal(openapi.status, 200);
  const contract = /** @type {OpenApiDocument} */ (await openapi.json());
  assert.equal(contract.openapi, "3.1.0");
  assert.equal(contract.components.schemas.Error.additionalProperties, true);
  assert.equal(
    contract.components.schemas.FieldError.additionalProperties,
    true,
  );
  assert.equal(contract.components.schemas.System.additionalProperties, true);
  assert.equal(
    contract.components.schemas.BootstrapFact.additionalProperties,
    true,
  );
  for (const schema of [
    "CurrentPasswordRequest",
    "LoginRequest",
    "PasswordChangeRequest",
    "SessionRevocationRequest",
  ]) {
    assert.equal(
      contract.components.schemas[schema].additionalProperties,
      false,
    );
  }
  assert.deepEqual(contract.components.schemas.System.properties.codex, {
    $ref: "#/components/schemas/CodexFact",
  });
  assert.equal(
    contract.components.schemas.CodexCapabilityCatalog.properties
      .codex_cli_version.const,
    CODEX_CAPABILITY_CATALOG.codex_cli_version,
  );
  assert.deepEqual(
    contract.components.schemas.CodexCapabilityCatalog.const,
    CODEX_CAPABILITY_CATALOG,
  );
  assert.deepEqual(
    contract.components.schemas.CodexModelCapability.oneOf,
    CODEX_CAPABILITY_CATALOG.models.map((model) => ({
      additionalProperties: false,
      properties: {
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
      required: ["id", "reasoning_efforts", "service_tiers"],
      type: "object",
    })),
  );
  assert.equal(
    contract.components.schemas.AuthorityAttribution.properties.occurred_at
      .format,
    "date-time",
  );
  assert.deepEqual(
    contract.components.schemas.AuthorityAttribution.properties.channel.enum,
    ["browser_session", "host", "implementer_token"],
  );
  assert.ok(contract.paths["/api/v1/system/authority-attributions"]);
  assert.ok(contract.paths["/api/v1/reviews"]);
  assert.equal(
    contract.paths["/api/v1/reviews"].post.operationId,
    "createReview",
  );
  assert.deepEqual(
    contract.paths["/api/v1/reviews"].post.parameters.map(
      ({ name, required }) => ({ name, required }),
    ),
    [
      { name: "Origin", required: true },
      { name: "x-quality-bar-csrf", required: true },
    ],
  );
  assert.deepEqual(contract.paths["/api/v1/reviews"].post.security, [
    { browser_session: [] },
  ]);
  assert.deepEqual(contract.paths["/api/v1/reviews"].get.security, [
    { browser_session: [] },
  ]);
  const reviewStateParameter =
    contract.paths["/api/v1/reviews"].get.parameters[0];
  assert.ok("schema" in reviewStateParameter);
  const reviewStateSchema = /** @type {{enum: string[]}} */ (
    reviewStateParameter.schema
  );
  assert.deepEqual(reviewStateSchema.enum, ["active", "archived"]);
  assert.deepEqual(contract.paths["/api/v1/repositories"].get.security, [
    { browser_session: [] },
    { implementer_token: [] },
  ]);
  assert.deepEqual(contract.paths["/api/v1/repositories"].post.security, [
    { browser_session: [] },
  ]);
  assert.deepEqual(
    contract.paths["/api/v1/repositories/{repository_id}/guidance"].get
      .security,
    [{ browser_session: [] }, { implementer_token: [] }],
  );
  assert.deepEqual(
    contract.paths["/api/v1/repositories"].get.parameters.map(
      ({ name }) => name,
    ),
    ["cursor", "limit"],
  );
  assert.equal(
    contract.components.schemas.RepositoryCollection.additionalProperties,
    false,
  );
  assert.deepEqual(contract.components.schemas.RepositoryCollection.required, [
    "repositories",
  ]);
  assert.deepEqual(
    Object.keys(
      contract.components.schemas.RepositoryCollection.properties,
    ).sort(),
    ["items", "next_cursor", "repositories"],
  );
  assert.equal(
    /** @type {{deprecated?: boolean}} */ (
      contract.components.schemas.RepositoryCollection.properties.repositories
    ).deprecated,
    true,
  );
  assert.deepEqual(
    contract.paths["/api/v1/reviews/{review_id}/archival"].patch.security,
    [{ browser_session: [] }],
  );
  assert.deepEqual(
    contract.paths["/api/v1/reviews/{review_id}/metadata"].patch.security,
    [{ browser_session: [] }],
  );
  assert.deepEqual(
    contract.paths["/api/v1/reviews/{review_id}/metadata"].patch.parameters.map(
      ({ name, required }) => ({ name, required }),
    ),
    [
      { name: "review_id", required: true },
      { name: "Origin", required: true },
      { name: "x-quality-bar-csrf", required: true },
    ],
  );
  assert.equal(
    contract.paths["/api/v1/reviews"].post.responses[201].description,
    "Review with its active immutable v1",
  );
  assert.ok(contract.paths["/api/v1/reviews"].post.responses[500]);
  assert.equal(
    contract.components.schemas.ReviewCreateRequest.properties.name.pattern,
    "\\S",
  );
  assert.equal(
    contract.components.schemas.ReviewCreateRequest.properties.description
      .pattern,
    "\\S",
  );
  assert.equal(
    contract.components.schemas.Review.properties.archived.type,
    "boolean",
  );
  assert.equal(
    contract.components.schemas.CriterionCreateRequest.properties.instruction
      .pattern,
    "\\S",
  );
  for (const schema of [
    "CriterionCreateRequest",
    "ReviewCreateRequest",
    "Criterion",
    "ReviewVersion",
    "Review",
  ]) {
    assert.equal(
      contract.components.schemas[schema].additionalProperties,
      false,
    );
  }
  for (const assignment of contract.components.schemas.ReviewAssignment.oneOf) {
    assert.equal(assignment.additionalProperties, false);
  }
  for (const configuration of contract.components.schemas.CodexConfiguration
    .oneOf) {
    assert.equal(configuration.additionalProperties, false);
  }
  for (const path of [
    "/api/v1/session/logout",
    "/api/v1/session/activity",
    "/api/v1/session/password",
    "/api/v1/sessions/revoke",
    "/api/v1/implementer-token",
    "/api/v1/implementer-token/rotate",
    "/api/v1/implementer-token/revoke",
  ]) {
    assert.deepEqual(
      contract.paths[path].post.parameters.map(({ name, required }) => ({
        name,
        required,
      })),
      [
        { name: "Origin", required: true },
        { name: "x-quality-bar-csrf", required: true },
      ],
    );
  }
  assert.ok(contract.paths["/api/v1/session/logout"].post.responses[503]);
  assert.ok(contract.paths["/api/v1/session/logout"].post.responses[400]);
  assert.ok(contract.paths["/api/v1/session/activity"].post.responses[400]);
  assert.ok(contract.paths["/api/v1/openapi.json"].get.responses[400]);
  assert.ok(contract.paths["/api/v1/system"].get.responses[400]);
  assert.ok(
    contract.paths["/api/v1/system/authority-attributions"].get.responses[503],
  );

  const system = await fetch(`${application.origin}/api/v1/system`, {
    headers: { cookie },
  });
  assert.equal(system.status, 200);
  assert.deepEqual(await system.json(), {
    bootstrap: { status: "complete" },
    browser_sessions: { active_count: 1, status: "available" },
    codex: { catalog: CODEX_CAPABILITY_CATALOG, status: "available" },
    codex_execution: {
      concurrency: {
        maximum_running: 1,
        running_count: 0,
        start_gate: "available",
      },
      failures: [],
      queue: { count: 0, rows: [] },
      running: { count: 0, rows: [] },
    },
    durable_core: { schema_version: 50, status: "ready" },
    implementer_token: { status: "active" },
    storage: availableStorageReserve.readFacts(),
  });

  const attributions = await fetch(
    `${application.origin}/api/v1/system/authority-attributions?limit=1`,
    { headers: { cookie } },
  );
  assert.equal(attributions.status, 200);
  const firstPage = /** @type {{
   *   items: {id: string, occurred_at: string}[],
   *   next_cursor: string,
   * }} */ (await attributions.json());
  assert.equal(firstPage.items.length, 1);
  assert.match(firstPage.items[0].id, /^[0-9a-f-]{36}$/);
  assert.match(
    firstPage.items[0].occurred_at,
    /^2026-07-25T12:00:0[01]\.000Z$/,
  );
  assert.equal(typeof firstPage.next_cursor, "string");
  assert.doesNotMatch(
    JSON.stringify(firstPage),
    new RegExp(`${password}|${token}`),
  );

  const secondPage = await fetch(
    `${application.origin}/api/v1/system/authority-attributions?cursor=${encodeURIComponent(firstPage.next_cursor)}&limit=1`,
    { headers: { cookie } },
  );
  assert.equal(secondPage.status, 200);
  const secondPageBody = /** @type {{items: {id: string}[]}} */ (
    await secondPage.json()
  );
  assert.notEqual(secondPageBody.items[0].id, firstPage.items[0].id);

  for (const [url, expectedCode] of [
    [
      `${application.origin}/api/v1/system/authority-attributions?unexpected=true`,
      "request_malformed",
    ],
    [
      `${application.origin}/api/v1/system/authority-attributions?limit=101`,
      "page_size_invalid",
    ],
    [
      `${application.origin}/api/v1/system/authority-attributions?cursor=not-a-cursor`,
      "cursor_invalid",
    ],
    [
      `${application.origin}/api/v1/system?unexpected=true`,
      "request_malformed",
    ],
    [
      `${application.origin}/api/v1/openapi.json?unexpected=true`,
      "request_malformed",
    ],
  ]) {
    const response = await fetch(url, { headers: { cookie } });
    assert.equal(response.status, 400);
    assert.equal(await responseErrorCode(response), expectedCode);
  }

  const unknownBrowserView = await fetch(
    `${application.origin}/?view=unknown`,
    {
      headers: { cookie },
    },
  );
  assert.equal(unknownBrowserView.status, 404);
  assert.equal(await responseErrorCode(unknownBrowserView), "not_found");

  const csrfMatch = setCookie.match(/quality_bar_csrf=([A-Za-z0-9_-]{43})/);
  if (!csrfMatch) {
    throw new Error("security_integration_csrf_cookie_missing");
  }
  const csrfToken = csrfMatch[1];
  const unknownMutationQuery = await fetch(
    `${application.origin}/api/v1/session/logout?unexpected=true`,
    {
      headers: {
        cookie: `${cookie}; quality_bar_csrf=${csrfToken}`,
        origin: "http://127.0.0.1:3000",
        "x-quality-bar-csrf": csrfToken,
      },
      method: "POST",
    },
  );
  assert.equal(unknownMutationQuery.status, 400);
  assert.equal(
    await responseErrorCode(unknownMutationQuery),
    "request_malformed",
  );

  const machineContract = await fetch(
    `${application.origin}/api/v1/openapi.json`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  assert.equal(machineContract.status, 200);
  const machineSystem = await fetch(`${application.origin}/api/v1/system`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(machineSystem.status, 403);
  assert.equal(
    await responseErrorCode(machineSystem),
    "authorization_forbidden",
  );
});
