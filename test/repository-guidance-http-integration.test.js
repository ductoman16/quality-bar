import assert from "node:assert/strict";
import { test } from "node:test";

import { createUnavailableRepositoryGuidanceService } from "../src/repository-guidance.js";
import { createReviewService } from "../src/review.js";
import {
  authenticatedOperatorHeaders,
  responseErrorCode,
  startApplication,
} from "./http-integration-support.js";
import { reviewRequest } from "./review-http-integration-support.js";

test("the authenticated Repository resource returns complete conditional Guidance", async () => {
  const { application, request } = await startApplication();
  application.durableCore.run(
    "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES (?, ?, ?, ?)",
    "repository/1",
    "https://example.com/repository.git",
    1,
    1,
  );
  const reviews = createReviewService(application.durableCore, {
    createId: (() => {
      let next = 0;
      return () => `http-guidance-${++next}`;
    })(),
    now: () => 2,
  });
  const review = reviews.create(
    reviewRequest({
      description: "Keep Repository Guidance complete.",
      name: "Repository Guidance",
    }),
  );
  reviews.saveVersion(review.id, {
    applicability_rule: "true",
    codex_configuration: review.active_version.codex_configuration,
    criteria: review.active_version.criteria.map(
      ({ id, impact, instruction }) => ({ id, impact, instruction }),
    ),
  });
  const headers = await authenticatedOperatorHeaders(request);

  const response = await request(
    "/api/v1/repositories/repository%2F1/guidance",
    {
      headers: { cookie: headers.cookie },
    },
  );

  assert.equal(response.status, 200);
  const guidance = /** @type {any} */ (await response.json());
  assert.deepEqual(guidance.repository, {
    id: "repository/1",
    url: "https://example.com/repository.git",
  });
  assert.deepEqual(guidance.reviews, [
    {
      active_version: { id: "http-guidance-4", number: 2 },
      applicability: {
        expression: "true",
        profile: "quality-bar-restricted-cel-v1",
        type: "conditional",
      },
      assignment: { scope: "installation_wide" },
      criteria: [
        {
          id: "http-guidance-3",
          impact: "advisory",
          instruction: "Preserve request authentication boundaries.",
        },
      ],
      description: "Keep Repository Guidance complete.",
      id: "http-guidance-1",
      name: "Repository Guidance",
    },
  ]);
  assert.equal(guidance.schema_version, 1);
  assert.equal(response.headers.get("etag"), `"${guidance.guidance_revision}"`);

  const token = application.implementerTokens.create(
    "a correct operator password",
  );
  const machineResponse = await request(
    "/api/v1/repositories/repository%2F1/guidance",
    {
      headers: { authorization: `Bearer ${token}` },
    },
  );
  assert.equal(machineResponse.status, 200);
  assert.deepEqual(await machineResponse.json(), guidance);
  assert.equal(
    machineResponse.headers.get("etag"),
    `"${guidance.guidance_revision}"`,
  );

  const unchanged = await request(
    "/api/v1/repositories/repository%2F1/guidance",
    {
      headers: {
        cookie: headers.cookie,
        "if-none-match": `"${guidance.guidance_revision}"`,
      },
    },
  );
  assert.equal(unchanged.status, 304);
  assert.equal(await unchanged.text(), "");
});

test("Repository Guidance rejects an unregistered Repository without a fallback document", async () => {
  const { application, request } = await startApplication();
  const operatorHeaders = await authenticatedOperatorHeaders(request);
  const missing = await request(
    "/api/v1/repositories/repository-missing/guidance",
    {
      headers: { cookie: operatorHeaders.cookie },
    },
  );
  assert.equal(missing.status, 404);
  assert.equal(await responseErrorCode(missing), "repository_not_found");

  const token = application.implementerTokens.create(
    "a correct operator password",
  );
  const machine = await request(
    "/api/v1/repositories/repository-missing/guidance",
    {
      headers: { authorization: `Bearer ${token}` },
    },
  );
  assert.equal(machine.status, 404);
  assert.equal(await responseErrorCode(machine), "repository_not_found");

  const malformed = await request("/api/v1/repositories/%ZZ/guidance", {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(malformed.status, 400);
  assert.equal(await responseErrorCode(malformed), "request_malformed");
});

test("Repository Guidance surfaces its exact owning unavailability without a partial document", async () => {
  const unavailable = Object.assign(
    new Error("Repository Guidance is unavailable"),
    { code: "repository_guidance_unavailable" },
  );
  const { application, request } = await startApplication({
    createRepositoryGuidance() {
      return createUnavailableRepositoryGuidanceService(unavailable);
    },
  });
  const token = application.implementerTokens.create(
    "a correct operator password",
  );

  const response = await request("/api/v1/repositories/repository-1/guidance", {
    headers: { authorization: `Bearer ${token}` },
  });

  assert.equal(response.status, 503);
  const body = /** @type {{
   *   error: {code: string, message: string},
   *   repository?: unknown,
   *   reviews?: unknown
   * }} */ (await response.json());
  assert.equal(body.error.code, "repository_guidance_unavailable");
  assert.equal(body.error.message, "Repository Guidance is unavailable");
  assert.equal("repository" in body, false);
  assert.equal("reviews" in body, false);
});
