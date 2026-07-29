import assert from "node:assert/strict";
import { test } from "node:test";

import { GitHubConnectionError } from "../src/github-connection.js";
import { createRepositoryService, RepositoryError } from "../src/repository.js";
import {
  authenticatedOperatorHeaders,
  responseErrorCode,
  startApplication,
} from "./http-integration-support.js";
import { assertRepositoryConflict } from "./repository-lifecycle-http-integration-support.js";

test("an authenticated operator changes Repository lifecycle through the canonical HTTP resource", async () => {
  let verificationFails = false;
  const { request } = await startApplication({
    createRepositories(core, options) {
      return createRepositoryService(core, {
        ...options,
        createId: () => "repository/public",
        async verifyRead() {
          if (verificationFails) {
            return Promise.reject(
              new RepositoryError(
                "repository_git_read_failed",
                "Repository Git read verification failed",
              ),
            );
          }
        },
      });
    },
  });
  const headers = await authenticatedOperatorHeaders(request);
  const registered = await request("/api/v1/repositories", {
    body: JSON.stringify({ url: "https://example.com/public.git" }),
    headers,
    method: "POST",
  });
  assert.equal(registered.status, 200);

  for (const [method, suffix, body] of [
    ["DELETE", "", "{}"],
    ["PATCH", "/lifecycle", JSON.stringify({ lifecycle: "disabled" })],
  ]) {
    const malformedIdentity = await request(
      `/api/v1/repositories/repository%ZZ${suffix}`,
      {
        body,
        headers,
        method,
      },
    );
    assert.equal(malformedIdentity.status, 400);
    assert.equal(
      await responseErrorCode(malformedIdentity),
      "request_malformed",
    );
  }

  const disabled = await request(
    "/api/v1/repositories/repository%2Fpublic/lifecycle",
    {
      body: JSON.stringify({ lifecycle: "disabled" }),
      headers,
      method: "PATCH",
    },
  );
  assert.equal(disabled.status, 200);
  assert.deepEqual(await disabled.json(), {
    credential_type: "none",
    deletion_eligible: true,
    health: "healthy",
    health_error: null,
    id: "repository/public",
    lifecycle: "disabled",
    url: "https://example.com/public.git",
  });

  verificationFails = true;
  const failedEnable = await request(
    "/api/v1/repositories/repository%2Fpublic/lifecycle",
    {
      body: JSON.stringify({ lifecycle: "enabled" }),
      headers,
      method: "PATCH",
    },
  );
  assert.equal(failedEnable.status, 422);
  assert.equal(
    await responseErrorCode(failedEnable),
    "repository_git_read_failed",
  );
  const afterFailedEnable = await request("/api/v1/repositories", {
    headers: { cookie: headers.cookie },
  });
  assert.deepEqual(await afterFailedEnable.json(), {
    items: [
      {
        credential_type: "none",
        deletion_eligible: true,
        health: "error",
        health_error: {
          code: "repository_git_read_failed",
          message: "Repository Git read verification failed",
        },
        id: "repository/public",
        lifecycle: "disabled",
        url: "https://example.com/public.git",
      },
    ],
    next_cursor: null,
    repositories: [
      {
        credential_type: "none",
        deletion_eligible: true,
        health: "error",
        health_error: {
          code: "repository_git_read_failed",
          message: "Repository Git read verification failed",
        },
        id: "repository/public",
        lifecycle: "disabled",
        url: "https://example.com/public.git",
      },
    ],
  });

  verificationFails = false;
  const enabled = await request(
    "/api/v1/repositories/repository%2Fpublic/lifecycle",
    {
      body: JSON.stringify({ lifecycle: "enabled" }),
      headers,
      method: "PATCH",
    },
  );
  assert.equal(enabled.status, 200);
  assert.deepEqual(await enabled.json(), {
    credential_type: "none",
    deletion_eligible: true,
    health: "healthy",
    health_error: null,
    id: "repository/public",
    lifecycle: "enabled",
    url: "https://example.com/public.git",
  });
});

test("Repository lifecycle conflicts return exact present and absent current state", async () => {
  let attempt = 0;
  const { request } = await startApplication({
    createRepositories(core, options) {
      const repositories = createRepositoryService(core, {
        ...options,
        createId: () => "repository-conflict",
        async verifyRead() {},
      });
      return {
        ...repositories,
        /** @param {string} repositoryId */
        async setLifecycle(repositoryId) {
          attempt += 1;
          if (attempt === 1) {
            throw Object.assign(
              new Error("Repository changed during lifecycle update"),
              { code: "repository_lifecycle_conflict" },
            );
          }
          repositories.remove(repositoryId);
          throw Object.assign(
            new Error("GitHub Repository changed during reactivation"),
            { code: "github_repository_enablement_conflict" },
          );
        },
      };
    },
  });
  const headers = await authenticatedOperatorHeaders(request);
  const registered = await request("/api/v1/repositories", {
    body: JSON.stringify({ url: "https://example.com/conflict.git" }),
    headers,
    method: "POST",
  });
  const current = await registered.json();

  const presentConflict = await request(
    "/api/v1/repositories/repository-conflict/lifecycle",
    {
      body: JSON.stringify({ lifecycle: "disabled" }),
      headers,
      method: "PATCH",
    },
  );
  await assertRepositoryConflict(presentConflict, {
    code: "repository_lifecycle_conflict",
    current,
    message: "Repository changed during lifecycle update",
  });

  const absentConflict = await request(
    "/api/v1/repositories/repository-conflict/lifecycle",
    {
      body: JSON.stringify({ lifecycle: "enabled" }),
      headers,
      method: "PATCH",
    },
  );
  await assertRepositoryConflict(absentConflict, { current: null });
});

test("failed GitHub lifecycle verification returns its exact error and records Repository health", async () => {
  let verificationError = new GitHubConnectionError(
    "github_permissions_mismatch",
    "GitHub App permissions do not match the required profile",
  );
  const { request } = await startApplication({
    createGitHubConnections(core) {
      const writableCore = /** @type {any} */ (core);
      writableCore.run(
        `INSERT INTO github_connections (
           id, app_id, app_slug, installation_id, principal_id,
           principal_login, api_profile, permissions, capabilities,
           repository_count, created_at, verified_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        "connection-1",
        47,
        "quality-bar-personal",
        73,
        91,
        "operator",
        "github-rest:2026-03-10",
        "{}",
        "{}",
        1,
        1_000,
        1_000,
      );
      return {
        startPolling() {},
        async selectRepositories() {
          throw verificationError;
        },
        read() {
          return null;
        },
        start() {
          throw new Error("unexpected");
        },
        async completeManifest() {
          throw new Error("unexpected");
        },
        async completeInstallation() {
          throw new Error("unexpected");
        },
        recordCallbackFailure() {
          throw new Error("unexpected");
        },
        consumeCallbackFailure() {
          return null;
        },
        destroy() {},
      };
    },
    createRepositories(core, options) {
      const writableCore = /** @type {any} */ (core);
      writableCore.run(
        `INSERT INTO github_connection_verifications (
           id, connection_id, trigger, outcome, error_code, error_message,
           error_repository_id, affected_repository_ids, repository_checks,
           repositories, verified_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        "verification-1",
        "connection-1",
        "enablement",
        "error",
        "github_repository_git_read_failed",
        "GitHub Repository Git read verification failed",
        101,
        JSON.stringify([101]),
        JSON.stringify([{ outcome: "error", repository_id: 101 }]),
        "[]",
        1_000,
      );
      writableCore.run(
        `INSERT INTO repositories (
           id, normalized_url, lifecycle, health, created_at, verified_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
        "github-repository",
        "https://github.com/operator/private.git",
        "enabled",
        "healthy",
        1_000,
        1_000,
      );
      writableCore.run(
        `INSERT INTO github_repositories (
           repository_id, connection_id, verification_id, forge_repository_id,
           name, api_url, web_url
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        "github-repository",
        "connection-1",
        "verification-1",
        101,
        "operator/private",
        "https://api.github.com/repos/operator/private",
        "https://github.com/operator/private",
      );
      return createRepositoryService(core, options);
    },
  });
  const headers = await authenticatedOperatorHeaders(request);
  await request("/api/v1/repositories/github-repository/lifecycle", {
    body: JSON.stringify({ lifecycle: "disabled" }),
    headers,
    method: "PATCH",
  });

  const failedEnable = await request(
    "/api/v1/repositories/github-repository/lifecycle",
    {
      body: JSON.stringify({ lifecycle: "enabled" }),
      headers,
      method: "PATCH",
    },
  );
  assert.equal(failedEnable.status, 422);
  assert.equal(
    await responseErrorCode(failedEnable),
    "github_permissions_mismatch",
  );
  let inventory = await request("/api/v1/repositories", {
    headers: { cookie: headers.cookie },
  });
  let body = /** @type {any} */ (await inventory.json());
  assert.equal(body.items[0].health, "healthy");
  assert.equal(body.items[0].health_error, null);

  verificationError = new GitHubConnectionError(
    "github_private_git_read_failed",
    "GitHub private Repository read verification failed",
    { repositoryId: 101 },
  );
  const repositoryFailure = await request(
    "/api/v1/repositories/github-repository/lifecycle",
    {
      body: JSON.stringify({ lifecycle: "enabled" }),
      headers,
      method: "PATCH",
    },
  );
  assert.equal(repositoryFailure.status, 422);
  assert.equal(
    await responseErrorCode(repositoryFailure),
    "github_private_git_read_failed",
  );
  inventory = await request("/api/v1/repositories", {
    headers: { cookie: headers.cookie },
  });
  body = /** @type {any} */ (await inventory.json());
  assert.deepEqual(body.items[0].health_error, {
    code: "github_private_git_read_failed",
    message: "GitHub private Repository read verification failed",
  });
  assert.equal(body.items[0].health, "error");
  assert.equal(body.items[0].lifecycle, "disabled");

  verificationError = new GitHubConnectionError(
    "github_repository_enablement_conflict",
    "GitHub Repository changed during reactivation",
  );
  const conflict = await request(
    "/api/v1/repositories/github-repository/lifecycle",
    {
      body: JSON.stringify({ lifecycle: "enabled" }),
      headers,
      method: "PATCH",
    },
  );
  await assertRepositoryConflict(conflict, { current: body.items[0] });
});
