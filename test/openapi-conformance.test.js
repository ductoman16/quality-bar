import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

import { canonicalOpenApiDocument } from "../src/canonical-api.js";
import {
  createConformingFetch,
  createHttpConformanceAssertion,
  validateOpenApi31Document,
} from "../scripts/openapi-conformance.mjs";
import {
  FAILED_REVIEW_RUN_EVALUATION_RESULT,
  TRIGGERED_EVALUATION_RESULT,
} from "./openapi-triggered-evaluation-result.js";

function documentedExchange(overrides = {}) {
  return {
    request: {
      body: JSON.stringify({ password: "a correct operator password" }),
      headers: { "content-type": "application/json" },
      method: "POST",
      url: "http://127.0.0.1/api/v1/session/login",
    },
    response: new Response(null, { status: 204 }),
    ...overrides,
  };
}

test("the complete published contract is structurally valid OpenAPI 3.1", async () => {
  const contract = canonicalOpenApiDocument();
  const before = JSON.stringify(contract);
  const facts = await validateOpenApi31Document(contract);

  assert.deepEqual(facts, {
    documents: 1,
    operations: 51,
    responseStatuses: 353,
    version: "3.1.0",
  });
  assert.equal(
    contract.components.schemas.ReviewCreateRequest.properties.assignment.$ref,
    "#/components/schemas/ReviewCreationAssignment",
  );
  assert.deepEqual(contract.components.schemas.ReviewCreationAssignment, {
    additionalProperties: false,
    properties: {
      scope: { const: "installation_wide", type: "string" },
    },
    required: ["scope"],
    type: "object",
  });
  assert.deepEqual(
    contract.components.schemas.GitHubRepositoryEvidence.required,
    ["api_url", "clone_url", "full_name", "html_url", "id", "private"],
  );
  assert.deepEqual(
    contract.components.schemas.GitHubRepositorySelectionRequest.required,
    ["repository_ids", "request_id"],
  );
  assert.equal(contract.components.schemas.Repository.oneOf.length, 2);
  assert.ok(
    contract.components.schemas.Repository.oneOf.every(
      (variant) => variant.oneOf.length === 2,
    ),
  );
  assert.equal(contract.components.schemas.GitHubConnection.oneOf.length, 2);
  assert.ok(
    contract.components.schemas.GitHubConnection.required.includes("polling"),
  );
  assert.equal(contract.components.schemas.GitHubPollingState.oneOf.length, 3);
  assert.equal(
    contract.components.schemas.GitHubConnectionVerification.oneOf.length,
    2,
  );
  const successVerificationSchema = /** @type {any} */ (
    contract.components.schemas.GitHubConnectionVerification.oneOf[0]
  );
  assert.equal(
    successVerificationSchema.properties.repository_checks.items.properties
      .outcome.const,
    "success",
  );
  assert.deepEqual(
    contract.components.schemas.Repository.oneOf[1].required.slice(-9),
    [
      "api_url",
      "assignment_count",
      "forge_connection_id",
      "forge_repository_id",
      "name",
      "provider",
      "verification_id",
      "verified_at",
      "web_url",
    ],
  );
  assert.equal(JSON.stringify(contract), before);
});

test("structural validation rejects unsupported and invalid contracts with owning diagnostics", async () => {
  const unsupported = canonicalOpenApiDocument();
  unsupported.openapi = "3.0.3";
  await assert.rejects(() => validateOpenApi31Document(unsupported), {
    message:
      "openapi_structure_unsupported_version: expected 3.1.x; received 3.0.3",
  });

  const invalid = canonicalOpenApiDocument();
  Reflect.deleteProperty(invalid, "info");
  await assert.rejects(() => validateOpenApi31Document(invalid), {
    message: "openapi_structure_invalid: / must have required property 'info'",
  });

  const unresolved = canonicalOpenApiDocument();
  unresolved.paths["/api/v1/reviews"].post.responses[201].content[
    "application/json"
  ].schema.$ref = "#/components/schemas/Missing";
  await assert.rejects(() => validateOpenApi31Document(unresolved), {
    message:
      "openapi_structure_invalid: / Can't resolve #/components/schemas/Missing",
  });
});

test("runtime conformance accepts a documented request and empty success", async () => {
  const assertion = await createHttpConformanceAssertion(
    canonicalOpenApiDocument(),
  );

  await assertion.assertExchange(documentedExchange());
  await assertion.assertExchange(
    documentedExchange({
      request: {
        body: JSON.stringify({
          token: "replacement-private-token",
          username: "replacement-operator",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
        url: "http://127.0.0.1/api/v1/repositories/repository-1/credential/rotate",
      },
      response: Response.json({
        credential_type: "username_token",
        deletion_eligible: true,
        health: "healthy",
        health_error: null,
        id: "repository-1",
        lifecycle: "enabled",
        url: "https://example.com/private.git",
      }),
    }),
  );
  assert.deepEqual(assertion.facts(), {
    canonicalErrors: 0,
    exchanges: 2,
    operations: 2,
    requestDocuments: 2,
    responseDocuments: 1,
    statuses: 2,
  });
});

test("runtime conformance accepts a triggered Finding Result", async () => {
  const assertion = await createHttpConformanceAssertion(
    canonicalOpenApiDocument(),
  );
  await assertion.assertExchange(
    documentedExchange({
      request: {
        method: "GET",
        url: "http://127.0.0.1/api/v1/evaluations/evaluation-1/result",
      },
      response: Response.json(TRIGGERED_EVALUATION_RESULT),
    }),
  );
  assert.equal(assertion.facts().responseDocuments, 1);
});

test("runtime conformance accepts an exact failed Review Run without Criterion Results or Findings", async () => {
  const assertion = await createHttpConformanceAssertion(
    canonicalOpenApiDocument(),
  );
  await assertion.assertExchange(
    documentedExchange({
      request: {
        method: "GET",
        url: "http://127.0.0.1/api/v1/evaluations/evaluation-run-failed/result",
      },
      response: Response.json(FAILED_REVIEW_RUN_EVALUATION_RESULT),
    }),
  );
  assert.equal(assertion.facts().responseDocuments, 1);
});

test("the shared HTTP fetch validates every exchange automatically", async () => {
  let calls = 0;
  const conformingFetch = await createConformingFetch(
    canonicalOpenApiDocument(),
    async () => {
      calls += 1;
      return new Response(null, { status: 202 });
    },
  );

  await assert.rejects(
    () =>
      conformingFetch("http://127.0.0.1/api/v1/session/login", {
        body: JSON.stringify({ password: "a correct operator password" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    {
      message:
        "openapi_status_unsupported: POST /api/v1/session/login returned 202",
    },
  );
  assert.equal(calls, 1);
});

test("runtime conformance rejects invalid request, response, status, content type, and canonical error fixtures", async () => {
  const assertion = await createHttpConformanceAssertion(
    canonicalOpenApiDocument(),
  );

  await assert.rejects(
    () =>
      assertion.assertExchange(
        documentedExchange({
          request: {
            body: JSON.stringify({ password: "valid", unexpected: true }),
            headers: { "content-type": "application/json" },
            method: "POST",
            url: "http://127.0.0.1/api/v1/session/login",
          },
        }),
      ),
    {
      message:
        "openapi_request_document_invalid: POST /api/v1/session/login / must NOT have additional properties",
    },
  );

  await assert.rejects(
    () =>
      assertion.assertExchange(
        documentedExchange({
          request: {
            method: "GET",
            url: "http://127.0.0.1/api/v1/repositories",
          },
          response: Response.json({
            repositories: [
              {
                credential_type: "none",
                deletion_eligible: true,
                health: "healthy",
                health_error: {
                  code: "stale_error",
                  message: "must not accompany healthy state",
                },
                id: "repository-1",
                lifecycle: "enabled",
                url: "https://example.com/private.git",
              },
            ],
          }),
        }),
      ),
    /openapi_success_document_invalid.*health_error/,
  );

  await assert.rejects(
    () =>
      assertion.assertExchange(
        documentedExchange({
          request: {
            method: "GET",
            url: "http://127.0.0.1/api/v1/system",
          },
          response: Response.json({}, { status: 200 }),
        }),
      ),
    {
      message:
        "openapi_success_document_invalid: GET /api/v1/system status 200 / must have required property 'bootstrap'",
    },
  );

  await assert.rejects(
    () =>
      assertion.assertExchange(
        documentedExchange({
          response: new Response(null, { status: 202 }),
        }),
      ),
    {
      message:
        "openapi_status_unsupported: POST /api/v1/session/login returned 202",
    },
  );

  await assert.rejects(
    () =>
      assertion.assertExchange(
        documentedExchange({
          request: {
            method: "GET",
            url: "http://127.0.0.1/api/v1/system",
          },
          response: new Response("{}", {
            headers: { "content-type": "text/plain" },
            status: 200,
          }),
        }),
      ),
    {
      message:
        "openapi_response_content_type_invalid: GET /api/v1/system status 200 expected application/json; received text/plain",
    },
  );

  const booleanSchemaContract = canonicalOpenApiDocument();
  const booleanSchemaMediaType = /** @type {Record<string, unknown>} */ (
    booleanSchemaContract.paths["/api/v1/system"].get.responses[200].content[
      "application/json"
    ]
  );
  booleanSchemaMediaType.schema = false;
  const booleanSchemaAssertion = await createHttpConformanceAssertion(
    booleanSchemaContract,
  );
  await assert.rejects(
    () =>
      booleanSchemaAssertion.assertExchange(
        documentedExchange({
          request: {
            method: "GET",
            url: "http://127.0.0.1/api/v1/system",
          },
          response: Response.json({}),
        }),
      ),
    {
      message:
        "openapi_success_document_invalid: GET /api/v1/system status 200 / boolean schema is false",
    },
  );

  const primitiveSchemaContract = canonicalOpenApiDocument();
  const primitiveSchemaMediaType = /** @type {Record<string, unknown>} */ (
    primitiveSchemaContract.paths["/api/v1/system"].get.responses[200].content[
      "application/json"
    ]
  );
  primitiveSchemaMediaType.schema = 42;
  await assert.rejects(
    () => createHttpConformanceAssertion(primitiveSchemaContract),
    {
      message:
        "openapi_structure_invalid: /paths/~1api~1v1~1system/get/responses/200/content/application~1json/schema must be object,boolean",
    },
  );

  await assert.rejects(
    () =>
      assertion.assertExchange(
        documentedExchange({
          response: Response.json(
            { error: { code: "authentication_failed" } },
            { status: 401 },
          ),
        }),
      ),
    {
      message:
        "openapi_canonical_error_invalid: POST /api/v1/session/login status 401 /error must have required property 'message'",
    },
  );
});

test("the canonical OpenAPI conformance evidence records the complete cleanup", () => {
  const evidence = JSON.parse(
    readFileSync(
      resolve(
        import.meta.dirname,
        "../evidence/quality-foundation/issue-165-openapi-conformance.json",
      ),
      "utf8",
    ),
  );

  assert.equal(evidence.ticket, 165);
  assert.deepEqual(evidence.published_contract, {
    documents: 1,
    operations: 12,
    response_statuses: 66,
    version: "3.1.0",
  });
  assert.deepEqual(evidence.cross_process_smokes, [
    "authenticated-firefox-browser-cross-process",
    "compose-service",
  ]);
  assert.equal(evidence.new_e2e_scenarios, 0);
  assert.equal(evidence.final_outcome, "pass");
});
