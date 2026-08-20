import assert from "node:assert/strict";
import { test } from "node:test";

import {
  authenticatedOperatorHeaders,
  startApplication,
} from "./http-integration-support.js";

test("registered Fastify schemas own validation and OpenAPI 3.1", async () => {
  const { application, request } = await startApplication();
  const document = /** @type {any} */ (application.server.swagger());
  const operations = Object.values(document.paths).flatMap((path) =>
    Object.values(path).filter((operation) => operation.operationId),
  );
  assert.equal(document.openapi, "3.1.0");
  assert.deepEqual(
    document.components.schemas.ReviewCreateRequest.properties
      .applicability_rule.type,
    ["string", "null"],
  );
  assert.equal(operations.length, 72);
  assert.equal(
    JSON.stringify(document).includes("x-canonical-validation"),
    false,
  );
  assert.deepEqual(
    document.paths[
      "/api/v1/repositories/{repository_id}/evaluations"
    ].post.parameters
      .map((/** @type {any} */ parameter) => [
        parameter.name.toLowerCase(),
        parameter.required,
      ])
      .toSorted(),
    [
      ["idempotency-key", true],
      ["origin", false],
      ["repository_id", true],
      ["x-quality-bar-csrf", false],
    ].toSorted(),
  );
  assert.deepEqual(
    document.paths["/api/v1/session/password"].post.parameters
      .map((/** @type {any} */ parameter) => [
        parameter.name.toLowerCase(),
        parameter.required,
      ])
      .toSorted(),
    [
      ["origin", true],
      ["x-quality-bar-csrf", true],
    ].toSorted(),
  );
  assert.deepEqual(
    document.paths[
      "/api/v1/repositories/{repository_id}/guidance"
    ].get.parameters
      .map((/** @type {any} */ parameter) => parameter.name.toLowerCase())
      .toSorted(),
    ["repository_id", "if-none-match"].toSorted(),
  );
  assert.equal(
    document.paths[
      "/api/v1/github-connections/callback-error"
    ].get.parameters.find(
      (/** @type {any} */ parameter) => parameter.name === "receipt",
    ).required,
    true,
  );

  const unauthenticated = await request("/api/v1/repositories", {
    body: JSON.stringify({ value: "x".repeat(9 * 1024) }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(unauthenticated.status, 401);

  const unknown = await request("/api/v1/does-not-exist");
  assert.equal(unknown.status, 401);
  const unknownBrowserMethod = await request("/", { method: "POST" });
  assert.equal(unknownBrowserMethod.status, 401);

  const browserPage = await request("/");
  const assetPath = (await browserPage.text()).match(
    /<script type="module"[^>]+src="([^"]+)"/,
  )?.[1];
  assert.ok(assetPath);
  const assetQuery = await request(`${assetPath}?unexpected=true`);
  assert.equal(assetQuery.status, 200);

  const operator = await authenticatedOperatorHeaders(request);
  const authenticatedUnknown = await request("/api/v1/does-not-exist", {
    headers: { cookie: operator.cookie },
  });
  assert.equal(authenticatedUnknown.status, 404);
  assert.equal(
    /** @type {any} */ (await authenticatedUnknown.json()).error.code,
    "not_found",
  );
  const authenticatedUnknownMutation = await request("/api/v1/does-not-exist", {
    headers: { cookie: operator.cookie },
    method: "POST",
  });
  assert.equal(authenticatedUnknownMutation.status, 404);
  const hiddenBootstrap = await request("/api/v1/operator-password/bootstrap", {
    body: "{",
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(hiddenBootstrap.status, 404);
  const token = application.implementerTokens.create(
    "a correct operator password",
  );
  const machineApiRoot = await request("/api/v1", {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(machineApiRoot.status, 404);
  const machineLogin = await request("/api/v1/session/login", {
    body: "{}",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    method: "POST",
  });
  assert.equal(machineLogin.status, 403);
  assert.equal(
    /** @type {any} */ (await machineLogin.json()).error.code,
    "authorization_forbidden",
  );
  const urlToken = await request("/api/v1/system?token=secret");
  assert.equal(urlToken.status, 401);
  assert.deepEqual(
    application.durableCore.get(
      `SELECT channel, error_code
       FROM authority_attributions
       WHERE action = 'authentication'
       ORDER BY occurred_at DESC, id DESC
       LIMIT 1`,
    ),
    { channel: "implementer_token", error_code: "authentication_invalid" },
  );
  const implicitHead = await request("/api/v1/repositories", {
    headers: { cookie: operator.cookie },
    method: "HEAD",
  });
  assert.equal(implicitHead.status, 404);
  const longParameter = await request(
    `/api/v1/repositories/${"x".repeat(101)}/guidance`,
    { headers: { cookie: operator.cookie } },
  );
  assert.equal(longParameter.status, 404);

  const badOrigin = await request("/api/v1/repositories", {
    body: "{}",
    headers: { ...operator, origin: "https://attacker.example" },
    method: "POST",
  });
  assert.equal(badOrigin.status, 403);
  assert.equal(
    /** @type {any} */ (await badOrigin.json()).error.code,
    "origin_invalid",
  );
  const rejectedLogout = await request("/api/v1/session/logout", {
    headers: { ...operator, origin: "https://attacker.example" },
    method: "POST",
  });
  assert.equal(rejectedLogout.status, 403);
  assert.ok(
    application.durableCore
      .all(
        "SELECT action, error_code FROM authority_attributions WHERE action = ?",
        "session_logout",
      )
      .some(
        (event) =>
          event?.action === "session_logout" &&
          event.error_code === "origin_invalid",
      ),
  );
  const wrongContentType = await request("/api/v1/repositories", {
    body: "{}",
    headers: {
      ...operator,
      "content-type": "application/json; charset=utf-8",
    },
    method: "POST",
  });
  assert.equal(wrongContentType.status, 400);

  for (const invalidPasswordRequest of [
    { body: "{", headers: operator },
    {
      body: JSON.stringify({ current_password: "current" }),
      headers: operator,
    },
    {
      body: JSON.stringify({
        current_password: "current",
        new_password: "new password value",
      }),
      headers: {
        ...operator,
        "content-type": "application/json; charset=utf-8",
      },
    },
  ]) {
    const invalidPassword = await request("/api/v1/session/password", {
      ...invalidPasswordRequest,
      method: "POST",
    });
    assert.equal(invalidPassword.status, 400);
  }
  assert.equal(
    application.durableCore.get(
      `SELECT count(*) AS count
       FROM authority_attributions
       WHERE action = 'password_change' AND error_code = 'request_malformed'`,
    )?.count,
    3,
  );

  const missingIdempotencyKey = await request(
    "/api/v1/repositories/repository-1/evaluations",
    {
      body: JSON.stringify({
        base: { type: "branch", value: "main" },
        head: { type: "branch", value: "topic" },
      }),
      headers: operator,
      method: "POST",
    },
  );
  assert.equal(missingIdempotencyKey.status, 400);
  assert.equal(
    /** @type {any} */ (await missingIdempotencyKey.json()).error.code,
    "idempotency_key_required",
  );

  const tooLarge = await request("/api/v1/repositories", {
    body: JSON.stringify({ value: "x".repeat(9 * 1024) }),
    headers: operator,
    method: "POST",
  });
  assert.equal(tooLarge.status, 400);
  const error = /** @type {any} */ (await tooLarge.json());
  assert.equal(error.error.code, "request_malformed");
  assert.match(error.error.request_id, /^[0-9a-f-]{36}$/);

  const published = await request("/api/v1/openapi.json", {
    headers: { cookie: operator.cookie },
  });
  assert.equal(published.status, 200);
  assert.equal(/** @type {any} */ (await published.json()).openapi, "3.1.0");
});
