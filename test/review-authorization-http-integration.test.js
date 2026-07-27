import assert from "node:assert/strict";
import { test } from "node:test";

import {
  responseErrorCode,
  reviewRequest,
  sessionCookies,
  startApplication,
} from "./review-http-integration-support.js";
import { createRepositoryService } from "../src/repository.js";

test("a sole implementer bearer creates the same Review resource without browser CSRF", async () => {
  const { application, request } = await startApplication();
  const token = application.implementerTokens.create(
    "a correct operator password",
  );

  const created = await request("/api/v1/reviews", {
    body: JSON.stringify(reviewRequest({ name: "Machine HTTP boundaries" })),
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    method: "POST",
  });
  assert.equal(created.status, 201);
  const createdReview = /** @type {{name: string}} */ (await created.json());
  assert.equal(createdReview.name, "Machine HTTP boundaries");
});

test("a sole implementer bearer cannot read or edit Review authoring resources", async () => {
  const { application, request } = await startApplication();
  const token = application.implementerTokens.create(
    "a correct operator password",
  );
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
  const forbiddenRepository = await request("/api/v1/repositories", {
    body: JSON.stringify({
      url: "https://example.com/repository.git",
    }),
    headers,
    method: "POST",
  });
  assert.equal(forbiddenRepository.status, 403);
  assert.equal(
    await responseErrorCode(forbiddenRepository),
    "authorization_forbidden",
  );
  const forbiddenRepositoryList = await request("/api/v1/repositories", {
    headers,
  });
  assert.equal(forbiddenRepositoryList.status, 403);
  assert.equal(
    await responseErrorCode(forbiddenRepositoryList),
    "authorization_forbidden",
  );
  const forbiddenCredentialRotation = await request(
    "/api/v1/repositories/repository-1/credential/rotate",
    {
      body: JSON.stringify({
        token: "replacement-private-token",
        username: "replacement-operator",
      }),
      headers,
      method: "POST",
    },
  );
  assert.equal(forbiddenCredentialRotation.status, 403);
  assert.equal(
    await responseErrorCode(forbiddenCredentialRotation),
    "authorization_forbidden",
  );
  const forbiddenLifecycle = await request(
    "/api/v1/repositories/repository-1/lifecycle",
    {
      body: JSON.stringify({ lifecycle: "disabled" }),
      headers,
      method: "PATCH",
    },
  );
  assert.equal(forbiddenLifecycle.status, 403);
  assert.equal(
    await responseErrorCode(forbiddenLifecycle),
    "authorization_forbidden",
  );
  const firstResponse = await request("/api/v1/reviews", {
    body: JSON.stringify(reviewRequest({ name: "First Review" })),
    headers,
    method: "POST",
  });
  const first = /** @type {{id: string, active_version: {id: string}}} */ (
    await firstResponse.json()
  );
  const listed = await request("/api/v1/reviews", { headers });
  assert.equal(listed.status, 403);
  assert.equal(await responseErrorCode(listed), "authorization_forbidden");

  const forbidden = await request(`/api/v1/reviews/${first.id}/metadata`, {
    body: JSON.stringify({
      description: "A forbidden edit.",
      name: "Forbidden Review",
    }),
    headers,
    method: "PATCH",
  });
  assert.equal(forbidden.status, 403);
  assert.equal(await responseErrorCode(forbidden), "authorization_forbidden");

  const forbiddenVersion = await request(
    `/api/v1/reviews/${first.id}/versions`,
    {
      body: JSON.stringify({
        applicability_rule: null,
        codex_configuration: {
          model: "gpt-5.6-terra",
          reasoning_effort: "high",
          service_tier: "standard",
        },
        criteria: [
          {
            id: `${first.id}-criterion`,
            impact: "blocking",
            instruction: "A forbidden executable change.",
          },
        ],
      }),
      headers,
      method: "POST",
    },
  );
  assert.equal(forbiddenVersion.status, 403);
  assert.equal(
    await responseErrorCode(forbiddenVersion),
    "authorization_forbidden",
  );
  const forbiddenReactivation = await request(
    `/api/v1/reviews/${first.id}/active-version`,
    {
      body: JSON.stringify({
        review_version_id: first.active_version.id,
      }),
      headers,
      method: "PATCH",
    },
  );
  assert.equal(forbiddenReactivation.status, 403);
  assert.equal(
    await responseErrorCode(forbiddenReactivation),
    "authorization_forbidden",
  );
  const forbiddenArchival = await request(
    `/api/v1/reviews/${first.id}/archival`,
    {
      body: JSON.stringify({ archived: true }),
      headers,
      method: "PATCH",
    },
  );
  assert.equal(forbiddenArchival.status, 403);
  assert.equal(
    await responseErrorCode(forbiddenArchival),
    "authorization_forbidden",
  );

  assert.deepEqual(
    application.durableCore.get(
      "SELECT name, description FROM reviews WHERE id = ?",
      first.id,
    ),
    {
      name: "First Review",
      description: "Keep authenticated mutations safe.",
    },
  );
  assert.equal(
    application.durableCore.get("SELECT count(*) AS count FROM review_versions")
      ?.count,
    1,
  );
});

test("an authenticated operator rotates a Generic credential through the secret-free canonical Repository resource", async () => {
  /** @type {object[]} */
  const verifications = [];
  const { request } = await startApplication({
    createRepositories(core, options) {
      return createRepositoryService(core, {
        ...options,
        createId: () => "repository/private",
        async verifyRead(url, credential) {
          verifications.push({ credential, url });
          if (credential?.token === "unexpected-sensitive-token") {
            throw new Error(
              `unexpected verifier detail: ${credential.username} ${credential.token}`,
            );
          }
        },
      });
    },
  });
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
  const registered = await request("/api/v1/repositories", {
    body: JSON.stringify({
      token: "original-private-token",
      url: "https://example.com/private.git",
      username: "original-operator",
    }),
    headers,
    method: "POST",
  });
  assert.equal(registered.status, 200);
  const listed = await request("/api/v1/repositories", {
    headers: { cookie: headers.cookie },
  });
  assert.equal(listed.status, 200);
  assert.deepEqual(await listed.json(), {
    repositories: [
      {
        credential_type: "username_token",
        health: "healthy",
        health_error: null,
        id: "repository/private",
        lifecycle: "enabled",
        url: "https://example.com/private.git",
      },
    ],
  });

  const rotated = await request(
    "/api/v1/repositories/repository%2Fprivate/credential/rotate",
    {
      body: JSON.stringify({
        token: "replacement-private-token",
        username: "replacement-operator",
      }),
      headers,
      method: "POST",
    },
  );
  assert.equal(rotated.status, 200);
  assert.deepEqual(await rotated.json(), {
    credential_type: "username_token",
    health: "healthy",
    health_error: null,
    id: "repository/private",
    lifecycle: "enabled",
    url: "https://example.com/private.git",
  });
  assert.deepEqual(verifications, [
    {
      credential: {
        token: "original-private-token",
        username: "original-operator",
      },
      url: "https://example.com/private.git",
    },
    {
      credential: {
        token: "replacement-private-token",
        username: "replacement-operator",
      },
      url: "https://example.com/private.git",
    },
  ]);

  const unexpected = await request(
    "/api/v1/repositories/repository%2Fprivate/credential/rotate",
    {
      body: JSON.stringify({
        token: "unexpected-sensitive-token",
        username: "unexpected-sensitive-operator",
      }),
      headers,
      method: "POST",
    },
  );
  assert.equal(unexpected.status, 500);
  const unexpectedBody = /** @type {{
   *   error: {code: string, message: string, request_id: string}
   * }} */ (await unexpected.json());
  assert.equal(
    unexpectedBody.error.code,
    "repository_credential_rotation_failed",
  );
  assert.equal(
    unexpectedBody.error.message,
    "Repository credential rotation failed",
  );
  assert.doesNotMatch(
    JSON.stringify(unexpectedBody),
    /unexpected-sensitive-token|unexpected-sensitive-operator/,
  );
});
