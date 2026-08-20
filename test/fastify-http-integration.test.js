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
  assert.equal(
    document.jsonSchemaDialect,
    "https://spec.openapis.org/oas/3.1/dialect/base",
  );
  assert.equal(operations.length, 72);
  assert.equal(
    JSON.stringify(document).includes("x-canonical-validation"),
    false,
  );
  assert.deepEqual(
    document.paths[
      "/api/v1/repositories/{repository_id}/evaluations"
    ].post.parameters.map((/** @type {any} */ parameter) => [
      parameter.name,
      parameter.required,
    ]),
    [
      ["repository_id", true],
      ["Origin", false],
      ["x-quality-bar-csrf", false],
      ["Idempotency-Key", true],
    ],
  );
  assert.deepEqual(
    document.paths["/api/v1/session/password"].post.parameters.map(
      (/** @type {any} */ parameter) => [parameter.name, parameter.required],
    ),
    [
      ["Origin", true],
      ["x-quality-bar-csrf", true],
    ],
  );
  assert.deepEqual(
    document.paths[
      "/api/v1/repositories/{repository_id}/guidance"
    ].get.parameters.map((/** @type {any} */ parameter) => parameter.name),
    ["repository_id", "If-None-Match"],
  );

  const unauthenticated = await request("/api/v1/repositories", {
    body: JSON.stringify({ value: "x".repeat(9 * 1024) }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(unauthenticated.status, 401);

  const unknown = await request("/api/v1/does-not-exist");
  assert.equal(unknown.status, 401);

  const assetQuery = await request("/assets/login.js?unexpected=true");
  assert.equal(assetQuery.status, 400);
  assert.equal(
    /** @type {any} */ (await assetQuery.json()).error.code,
    "request_malformed",
  );

  const operator = await authenticatedOperatorHeaders(request);
  const authenticatedUnknown = await request("/api/v1/does-not-exist", {
    headers: { cookie: operator.cookie },
  });
  assert.equal(authenticatedUnknown.status, 404);
  assert.equal(
    /** @type {any} */ (await authenticatedUnknown.json()).error.code,
    "not_found",
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
  const wrongContentType = await request("/api/v1/repositories", {
    body: "{}",
    headers: {
      ...operator,
      "content-type": "application/json; charset=utf-8",
    },
    method: "POST",
  });
  assert.equal(wrongContentType.status, 400);

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
