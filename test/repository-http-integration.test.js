import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createRepositoryService,
  createUnavailableRepositoryService,
} from "../src/repository.js";
import {
  authenticatedOperatorHeaders,
  responseErrorCode,
  startApplication,
} from "./http-integration-support.js";

test("a sole implementer bearer locates Repositories but cannot administer them", async () => {
  const { application, request } = await startApplication();
  const token = application.implementerTokens.create(
    "a correct operator password",
  );
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
  const forbiddenRepository = await request("/api/v1/repositories", {
    body: JSON.stringify({ url: "https://example.com/repository.git" }),
    headers,
    method: "POST",
  });
  assert.equal(forbiddenRepository.status, 403);
  assert.equal(
    await responseErrorCode(forbiddenRepository),
    "authorization_forbidden",
  );
  const repositoryList = await request("/api/v1/repositories", {
    headers,
  });
  assert.equal(repositoryList.status, 200);
  assert.deepEqual(await repositoryList.json(), {
    items: [],
    next_cursor: null,
    repositories: [],
  });
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
});

test("the machine Repository collection uses validated opaque keyset pagination", async () => {
  const { application, request } = await startApplication();
  for (let index = 0; index < 51; index += 1) {
    application.durableCore.run(
      "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES (?, ?, ?, ?)",
      `repository-${String(index).padStart(2, "0")}`,
      `https://example.com/repository-${String(index).padStart(2, "0")}.git`,
      index,
      index,
    );
  }
  const token = application.implementerTokens.create(
    "a correct operator password",
  );
  const headers = { authorization: `Bearer ${token}` };

  const firstResponse = await request("/api/v1/repositories", { headers });
  assert.equal(firstResponse.status, 200);
  const firstPage = /** @type {{
   *   items: Array<{id: string}>,
   *   next_cursor: string | null,
   *   repositories: Array<{id: string}>
   * }} */ (await firstResponse.json());
  assert.equal(firstPage.items.length, 50);
  assert.equal(firstPage.items[0]?.id, "repository-00");
  assert.equal(firstPage.items[49]?.id, "repository-49");
  assert.deepEqual(firstPage.repositories, firstPage.items);
  assert.equal(typeof firstPage.next_cursor, "string");
  assert.doesNotMatch(
    /** @type {string} */ (firstPage.next_cursor),
    /repository|example/,
  );

  const secondResponse = await request(
    `/api/v1/repositories?cursor=${encodeURIComponent(
      /** @type {string} */ (firstPage.next_cursor),
    )}`,
    { headers },
  );
  assert.equal(secondResponse.status, 200);
  assert.deepEqual(await secondResponse.json(), {
    items: [
      {
        credential_type: "none",
        health: "healthy",
        health_error: null,
        id: "repository-50",
        lifecycle: "enabled",
        url: "https://example.com/repository-50.git",
      },
    ],
    next_cursor: null,
    repositories: [
      {
        credential_type: "none",
        health: "healthy",
        health_error: null,
        id: "repository-50",
        lifecycle: "enabled",
        url: "https://example.com/repository-50.git",
      },
    ],
  });

  const excessive = await request("/api/v1/repositories?limit=101", {
    headers,
  });
  assert.equal(excessive.status, 400);
  assert.equal(await responseErrorCode(excessive), "page_size_invalid");

  const invalidCursor = await request(
    "/api/v1/repositories?cursor=not-an-opaque-cursor",
    { headers },
  );
  assert.equal(invalidCursor.status, 400);
  assert.equal(await responseErrorCode(invalidCursor), "cursor_invalid");
});

test("Repository discovery surfaces its exact owning unavailability without a partial collection", async () => {
  const unavailable = Object.assign(
    new Error("Repository discovery is unavailable"),
    { code: "repository_discovery_unavailable" },
  );
  const { application, request } = await startApplication({
    createRepositories() {
      return createUnavailableRepositoryService(unavailable);
    },
  });
  const token = application.implementerTokens.create(
    "a correct operator password",
  );

  const response = await request("/api/v1/repositories", {
    headers: { authorization: `Bearer ${token}` },
  });

  assert.equal(response.status, 503);
  const body = /** @type {{
   *   error: {code: string, message: string},
   *   items?: unknown,
   *   repositories?: unknown
   * }} */ (await response.json());
  assert.equal(body.error.code, "repository_discovery_unavailable");
  assert.equal(body.error.message, "Repository discovery is unavailable");
  assert.equal("items" in body, false);
  assert.equal("repositories" in body, false);
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
  const headers = await authenticatedOperatorHeaders(request);
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
    items: [
      {
        credential_type: "username_token",
        health: "healthy",
        health_error: null,
        id: "repository/private",
        lifecycle: "enabled",
        url: "https://example.com/private.git",
      },
    ],
    next_cursor: null,
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
