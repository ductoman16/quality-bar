import assert from "node:assert/strict";
import { test } from "node:test";

import {
  responseErrorCode,
  reviewRequest,
  sessionCookies,
  startApplication,
} from "./review-http-integration-support.js";

test("an API-looking path outside the exact version boundary stays not found", async () => {
  const { request } = await startApplication();

  const response = await request("/api/v10?unexpected=value");

  assert.equal(response.status, 404);
  assert.equal(await responseErrorCode(response), "not_found");
});

test("the authenticated Review resource creates only an exact complete v1 snapshot", async () => {
  const { application, request } = await startApplication();
  const login = await request("/api/v1/session/login", {
    body: JSON.stringify({ password: "a correct operator password" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const { csrf, session } = sessionCookies(login);
  const headers = {
    "content-type": "application/json",
    cookie: `${session}; quality_bar_csrf=${csrf}`,
    origin: "http://127.0.0.1:3000",
    "x-quality-bar-csrf": csrf,
  };

  const created = await request("/api/v1/reviews", {
    body: JSON.stringify(reviewRequest()),
    headers,
    method: "POST",
  });
  assert.equal(created.status, 201);
  const createdReview = /** @type {{active_version: {number: number}}} */ (
    await created.json()
  );
  assert.equal(createdReview.active_version.number, 1);

  const rejected = await request.invalidRequest("/api/v1/reviews", {
    body: JSON.stringify(reviewRequest({ unexpected: true })),
    headers,
    method: "POST",
  });
  assert.equal(rejected.status, 422);
  assert.equal(await responseErrorCode(rejected), "review_request_malformed");
  const reviewCount = application.durableCore.get(
    "SELECT count(*) AS count FROM reviews",
  );
  assert.equal(reviewCount?.count, 1);
});

test("the authenticated Review metadata resource edits only lineage metadata", async () => {
  const { application, request } = await startApplication();
  const login = await request("/api/v1/session/login", {
    body: JSON.stringify({ password: "a correct operator password" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const { csrf, session } = sessionCookies(login);
  const headers = {
    "content-type": "application/json",
    cookie: `${session}; quality_bar_csrf=${csrf}`,
    origin: "http://127.0.0.1:3000",
    "x-quality-bar-csrf": csrf,
  };
  const createdResponse = await request("/api/v1/reviews", {
    body: JSON.stringify(reviewRequest()),
    headers,
    method: "POST",
  });
  const created =
    /** @type {{id: string, active_version: {id: string, number: number}}} */ (
      await createdResponse.json()
    );
  const listedResponse = await request("/api/v1/reviews", {
    headers: { cookie: session },
  });
  assert.equal(listedResponse.status, 200);
  assert.deepEqual(await listedResponse.json(), { reviews: [created] });

  const updatedResponse = await request(
    `/api/v1/reviews/${created.id}/metadata`,
    {
      body: JSON.stringify({
        description: "Keep every authenticated mutation boundary safe.",
        name: "Authenticated HTTP boundaries",
      }),
      headers,
      method: "PATCH",
    },
  );

  assert.equal(updatedResponse.status, 200);
  const updated =
    /** @type {{name: string, description: string, active_version: {id: string, number: number}}} */ (
      await updatedResponse.json()
    );
  assert.equal(updated.name, "Authenticated HTTP boundaries");
  assert.equal(
    updated.description,
    "Keep every authenticated mutation boundary safe.",
  );
  assert.deepEqual(updated.active_version, created.active_version);
  assert.equal(
    application.durableCore.get("SELECT count(*) AS count FROM review_versions")
      ?.count,
    1,
  );

  const rejectedResponse = await request.invalidRequest(
    `/api/v1/reviews/${created.id}/metadata`,
    {
      body: JSON.stringify({
        description: "Keep this local value.",
        name: " ",
      }),
      headers,
      method: "PATCH",
    },
  );
  assert.equal(rejectedResponse.status, 422);
  assert.equal(
    await responseErrorCode(rejectedResponse),
    "review_name_invalid",
  );
  assert.deepEqual(
    application.durableCore.get(
      "SELECT name, description, active_version_id FROM reviews WHERE id = ?",
      created.id,
    ),
    {
      name: "Authenticated HTTP boundaries",
      description: "Keep every authenticated mutation boundary safe.",
      active_version_id: created.active_version.id,
    },
  );
});

test("the authenticated Review Version resource saves a complete snapshot or explicitly does nothing", async () => {
  const { application, request } = await startApplication();
  const login = await request("/api/v1/session/login", {
    body: JSON.stringify({ password: "a correct operator password" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const { csrf, session } = sessionCookies(login);
  const headers = {
    "content-type": "application/json",
    cookie: `${session}; quality_bar_csrf=${csrf}`,
    origin: "http://127.0.0.1:3000",
    "x-quality-bar-csrf": csrf,
  };
  const createdResponse = await request("/api/v1/reviews", {
    body: JSON.stringify(
      reviewRequest({
        criteria: [
          {
            impact: "advisory",
            instruction: "Preserve request authentication boundaries.",
          },
          {
            impact: "blocking",
            instruction: "Keep durable writes atomic.",
          },
        ],
      }),
    ),
    headers,
    method: "POST",
  });
  const created =
    /** @type {{id: string, active_version: {id: string, criteria: Array<{id: string, impact: string, instruction: string, position: number}>}}} */ (
      await createdResponse.json()
    );
  const [firstCriterion, secondCriterion] = created.active_version.criteria;
  assert.ok(firstCriterion);
  assert.ok(secondCriterion);
  const snapshot = {
    applicability_rule: "true",
    codex_configuration: {
      model: "gpt-5.6-sol",
      reasoning_effort: "xhigh",
      service_tier: "fast",
    },
    criteria: [
      {
        id: secondCriterion.id,
        impact: "blocking",
        instruction: "Keep every durable write atomic.",
      },
      {
        id: firstCriterion.id,
        impact: "blocking",
        instruction: "Preserve authenticated mutation boundaries.",
      },
    ],
  };

  const savedResponse = await request(
    `/api/v1/reviews/${created.id}/versions`,
    {
      body: JSON.stringify(snapshot),
      headers,
      method: "POST",
    },
  );
  assert.equal(savedResponse.status, 200);
  const savedResult =
    /** @type {{changed: boolean, review: {active_version: {id: string, number: number, applicability_rule: string | null, criteria: Array<{id: string, impact: string, instruction: string, position: number}>}}}} */ (
      await savedResponse.json()
    );
  assert.equal(savedResult.changed, true);
  const saved = savedResult.review;
  assert.notEqual(saved.active_version.id, created.active_version.id);
  assert.equal(saved.active_version.number, 2);
  assert.equal(saved.active_version.applicability_rule, "true");
  assert.deepEqual(saved.active_version.criteria, [
    {
      id: secondCriterion.id,
      impact: "blocking",
      instruction: "Keep every durable write atomic.",
      position: 1,
    },
    {
      id: firstCriterion.id,
      impact: "blocking",
      instruction: "Preserve authenticated mutation boundaries.",
      position: 2,
    },
  ]);

  const unchangedResponse = await request(
    `/api/v1/reviews/${created.id}/versions`,
    {
      body: JSON.stringify(snapshot),
      headers,
      method: "POST",
    },
  );
  assert.equal(unchangedResponse.status, 200);
  assert.deepEqual(await unchangedResponse.json(), {
    changed: false,
    review: saved,
  });
  assert.equal(
    application.durableCore.get("SELECT count(*) AS count FROM review_versions")
      ?.count,
    2,
  );

  const rejectedResponse = await request.invalidRequest(
    `/api/v1/reviews/${created.id}/versions`,
    {
      body: JSON.stringify({ ...snapshot, unexpected: true }),
      headers,
      method: "POST",
    },
  );
  assert.equal(rejectedResponse.status, 422);
  assert.equal(
    await responseErrorCode(rejectedResponse),
    "review_version_request_malformed",
  );
  assert.equal(
    application.durableCore.get("SELECT count(*) AS count FROM review_versions")
      ?.count,
    2,
  );
});

test("an unexpected Review resource failure has an exact owning error", async () => {
  const failure = new Error("exact Review resource failure");
  let listAttempt = 0;
  const { request } = await startApplication({
    createReviews() {
      return {
        list() {
          listAttempt += 1;
          if (listAttempt === 2) {
            throw Object.assign(new Error("Review storage is unavailable"), {
              code: "storage_unavailable",
            });
          }
          if (listAttempt === 3) {
            throw Object.assign(new Error("Review list is invalid"), {
              code: "review_list_invalid",
            });
          }
          throw failure;
        },
        create() {
          throw failure;
        },
        saveVersion() {
          throw failure;
        },
        updateMetadata() {
          throw new Error("unused Review metadata update");
        },
      };
    },
  });
  const login = await request("/api/v1/session/login", {
    body: JSON.stringify({ password: "a correct operator password" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const { csrf, session } = sessionCookies(login);
  const listed = await request("/api/v1/reviews", {
    headers: { cookie: session },
  });
  assert.equal(listed.status, 500);
  const listedFailure =
    /** @type {{error: {code: string, message: string}}} */ (
      await listed.json()
    );
  assert.equal(listedFailure.error.code, "review_list_failed");
  assert.equal(listedFailure.error.message, "exact Review resource failure");
  const unavailableList = await request("/api/v1/reviews", {
    headers: { cookie: session },
  });
  assert.equal(unavailableList.status, 503);
  const unavailableFailure =
    /** @type {{error: {code: string, message: string}}} */ (
      await unavailableList.json()
    );
  assert.equal(unavailableFailure.error.code, "storage_unavailable");
  assert.equal(
    unavailableFailure.error.message,
    "Review storage is unavailable",
  );
  const invalidList = await request("/api/v1/reviews", {
    headers: { cookie: session },
  });
  assert.equal(invalidList.status, 500);
  const invalidFailure =
    /** @type {{error: {code: string, message: string}}} */ (
      await invalidList.json()
    );
  assert.equal(invalidFailure.error.code, "review_list_failed");
  assert.equal(invalidFailure.error.message, "Review list is invalid");
  const response = await request("/api/v1/reviews", {
    body: JSON.stringify(reviewRequest()),
    headers: {
      "content-type": "application/json",
      cookie: `${session}; quality_bar_csrf=${csrf}`,
      origin: "http://127.0.0.1:3000",
      "x-quality-bar-csrf": csrf,
    },
    method: "POST",
  });
  assert.equal(response.status, 500);
  const body =
    /** @type {{error: {code: string, message: string, request_id: string}}} */ (
      await response.json()
    );
  assert.equal(body.error.code, "review_creation_failed");
  assert.equal(body.error.message, "exact Review resource failure");
  assert.match(body.error.request_id, /^[0-9a-f-]{36}$/);

  const versionResponse = await request("/api/v1/reviews/review-1/versions", {
    body: JSON.stringify({
      applicability_rule: null,
      codex_configuration: {
        model: "gpt-5.6-terra",
        reasoning_effort: "high",
        service_tier: "standard",
      },
      criteria: [
        {
          id: "criterion-1",
          impact: "advisory",
          instruction: "Keep failures exact.",
        },
      ],
    }),
    headers: {
      "content-type": "application/json",
      cookie: `${session}; quality_bar_csrf=${csrf}`,
      origin: "http://127.0.0.1:3000",
      "x-quality-bar-csrf": csrf,
    },
    method: "POST",
  });
  const versionFailure =
    /** @type {{error: {code: string, message: string}}} */ (
      await versionResponse.json()
    );
  assert.equal(versionFailure.error.code, "review_version_save_failed");
  assert.equal(versionFailure.error.message, "exact Review resource failure");
});
