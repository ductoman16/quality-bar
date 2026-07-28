import assert from "node:assert/strict";
import { test } from "node:test";

import {
  authenticatedOperatorHeaders,
  responseErrorCode,
  startApplication,
} from "./http-integration-support.js";

test("Forgejo Connection HTTP registration keeps PAT input write-only and preserves its owning error", async () => {
  /** @type {unknown[]} */
  const calls = [];
  let conflict = "none";
  /** @type {null | Record<string, unknown>} */
  let current = null;
  const verificationHistory = [
    {
      api_profile: "forgejo-v16",
      capabilities: {},
      error: null,
      id: "verification-1",
      outcome: "success",
      principal: { id: 7, login: "operator" },
      reported_version: "16.0.4",
      repositories: [
        {
          api_url: "https://forgejo.example/api/v1/repos/operator/private",
          clone_url: "https://forgejo.example/operator/private.git",
          full_name: "operator/private",
          html_url: "https://forgejo.example/operator/private",
          id: 11,
          outcome: "success",
          permissions: { admin: true, pull: true, push: true },
          private: true,
        },
      ],
      scopes: ["read:repository", "write:issue", "write:repository"],
      trigger: "onboarding",
      verified_at: 1_000,
    },
  ];
  const { request } = await startApplication({
    createForgejoConnections() {
      return {
        async discover(/** @type {unknown} */ input) {
          calls.push(input);
          return [
            {
              full_name: "operator/private",
              id: 11,
            },
          ];
        },
        async connect(/** @type {unknown} */ input) {
          calls.push(input);
          throw Object.assign(
            new Error(
              conflict === "connection"
                ? "A Forgejo Connection is already configured"
                : "Forgejo Connection requires stable v16.x",
            ),
            {
              code:
                conflict === "connection"
                  ? "forgejo_connection_conflict"
                  : conflict === "repository"
                    ? "forgejo_repository_identity_conflict"
                    : "forgejo_version_unsupported",
            },
          );
        },
        async rotate(/** @type {unknown} */ input) {
          calls.push(input);
          if (conflict === "rotation") {
            current = {
              api_profile: "forgejo-v16",
              base_url: "https://forgejo.example",
              capabilities: {},
              health: "error",
              health_error: {
                code: "forgejo_connection_rotation_conflict",
                message: "Forgejo PAT changed during rotation",
              },
              id: "forgejo-connection",
              lifecycle: "enabled",
              principal: { id: 7, login: "operator" },
              reported_version: "16.0.4",
              scopes: ["read:repository", "write:issue", "write:repository"],
              verification_history: verificationHistory,
              verified_at: 2_000,
            };
            throw Object.assign(
              new Error("Forgejo PAT changed during rotation"),
              {
                code: "forgejo_connection_rotation_conflict",
              },
            );
          }
          return {
            api_profile: "forgejo-v16",
            base_url: "https://forgejo.example",
            capabilities: {},
            health: "healthy",
            health_error: null,
            id: "forgejo-connection",
            lifecycle: "enabled",
            principal: { id: 7, login: "operator" },
            reported_version: "16.0.4",
            scopes: ["read:repository", "write:issue", "write:repository"],
            verification_history: verificationHistory,
            verified_at: 1_000,
          };
        },
        async reactivate(/** @type {unknown} */ input) {
          calls.push(["reactivate", input]);
          if (conflict === "reactivation") {
            throw Object.assign(
              new Error(
                "Forgejo Connection must be retired before reactivation",
              ),
              { code: "forgejo_connection_reactivation_unsupported" },
            );
          }
          return {
            api_profile: "forgejo-v16",
            base_url: "https://forgejo.example",
            capabilities: {},
            health: "healthy",
            health_error: null,
            id: "forgejo-connection",
            lifecycle: "enabled",
            principal: { id: 7, login: "operator" },
            reported_version: "16.0.4",
            scopes: ["read:repository", "write:issue", "write:repository"],
            verification_history: verificationHistory,
            verified_at: 3_000,
          };
        },
        retire(/** @type {unknown} */ input) {
          calls.push(["retire", input]);
          if (conflict === "dependents") {
            throw Object.assign(
              new Error(
                "Forgejo Connection cannot retire while dependent Repositories are enabled or disabled",
              ),
              { code: "forgejo_connection_repositories_active" },
            );
          }
          return {
            api_profile: "forgejo-v16",
            base_url: "https://forgejo.example",
            capabilities: {},
            health: "healthy",
            health_error: null,
            id: "forgejo-connection",
            lifecycle: "retired",
            principal: { id: 7, login: "operator" },
            reported_version: "16.0.4",
            scopes: ["read:repository", "write:issue", "write:repository"],
            verification_history: verificationHistory,
            verified_at: 2_000,
          };
        },
        remove() {
          calls.push(["remove"]);
          if (conflict === "used") {
            throw Object.assign(
              new Error(
                "Forgejo Connection with dependent Repositories must be retired",
              ),
              { code: "forgejo_connection_delete_unsupported" },
            );
          }
        },
        destroy() {},
        read() {
          return current;
        },
      };
    },
  });
  const headers = await authenticatedOperatorHeaders(request);
  const anonymous = await request("/api/v1/forgejo-connections");
  assert.equal(anonymous.status, 401);
  const response = await request("/api/v1/forgejo-connections", {
    body: JSON.stringify({
      base_url: "https://forgejo.example",
      repository_ids: [11],
      token: "operator-created-pat",
    }),
    headers,
    method: "POST",
  });
  assert.equal(response.status, 422);
  assert.equal(
    await responseErrorCode(response),
    "forgejo_version_unsupported",
  );
  assert.deepEqual(calls, [
    {
      base_url: "https://forgejo.example",
      repository_ids: [11],
      token: "operator-created-pat",
    },
  ]);
  const discovery = await request("/api/v1/forgejo-connections/discover", {
    body: JSON.stringify({
      base_url: "https://forgejo.example",
      token: "operator-created-pat",
    }),
    headers,
    method: "POST",
  });
  assert.equal(discovery.status, 200);
  assert.deepEqual(await discovery.json(), [
    { full_name: "operator/private", id: 11 },
  ]);
  const read = await request("/api/v1/forgejo-connections", { headers });
  assert.equal(read.status, 200);
  assert.equal(await read.json(), null);
  const query = await request("/api/v1/forgejo-connections?unexpected=true", {
    headers,
  });
  assert.equal(query.status, 400);
  conflict = "connection";
  const duplicate = await request("/api/v1/forgejo-connections", {
    body: JSON.stringify({
      base_url: "https://forgejo.example",
      repository_ids: [11],
      token: "operator-created-pat",
    }),
    headers,
    method: "POST",
  });
  assert.equal(duplicate.status, 409);
  assert.equal(
    await responseErrorCode(duplicate),
    "forgejo_connection_conflict",
  );
  conflict = "repository";
  const repositoryConflict = await request("/api/v1/forgejo-connections", {
    body: JSON.stringify({
      base_url: "https://forgejo.example",
      repository_ids: [11],
      token: "operator-created-pat",
    }),
    headers,
    method: "POST",
  });
  assert.equal(repositoryConflict.status, 409);
  assert.equal(
    await responseErrorCode(repositoryConflict),
    "forgejo_repository_identity_conflict",
  );
  const rotated = await request(
    "/api/v1/forgejo-connections/credential/rotate",
    {
      body: JSON.stringify({ token: "replacement-pat" }),
      headers,
      method: "POST",
    },
  );
  assert.equal(rotated.status, 200);
  assert.equal(
    /** @type {{id: string}} */ (await rotated.json()).id,
    "forgejo-connection",
  );
  assert.deepEqual(calls.at(-1), { token: "replacement-pat" });
  conflict = "rotation";
  const stale = await request("/api/v1/forgejo-connections/credential/rotate", {
    body: JSON.stringify({ token: "stale-replacement-pat" }),
    headers,
    method: "POST",
  });
  assert.equal(stale.status, 409);
  assert.equal(
    await responseErrorCode(stale),
    "forgejo_connection_rotation_conflict",
  );
  const unhealthy = await request("/api/v1/forgejo-connections", { headers });
  assert.equal(unhealthy.status, 200);
  const unhealthyBody = /** @type {{health: string, health_error: unknown}} */ (
    await unhealthy.json()
  );
  assert.equal(unhealthyBody.health, "error");
  assert.deepEqual(unhealthyBody.health_error, {
    code: "forgejo_connection_rotation_conflict",
    message: "Forgejo PAT changed during rotation",
  });
  conflict = "dependents";
  const blockedRetirement = await request(
    "/api/v1/forgejo-connections/lifecycle",
    {
      body: JSON.stringify({ lifecycle: "retired" }),
      headers,
      method: "PATCH",
    },
  );
  assert.equal(blockedRetirement.status, 409);
  assert.equal(
    await responseErrorCode(blockedRetirement),
    "forgejo_connection_repositories_active",
  );
  conflict = "used";
  const blockedDeletion = await request(
    "/api/v1/forgejo-connections/lifecycle",
    {
      body: "{}",
      headers,
      method: "DELETE",
    },
  );
  assert.equal(blockedDeletion.status, 409);
  assert.equal(
    await responseErrorCode(blockedDeletion),
    "forgejo_connection_delete_unsupported",
  );
  conflict = "reactivation";
  const blockedReactivation = await request(
    "/api/v1/forgejo-connections/reactivate",
    {
      body: JSON.stringify({ token: "replacement-pat" }),
      headers,
      method: "POST",
    },
  );
  assert.equal(blockedReactivation.status, 409);
  assert.equal(
    await responseErrorCode(blockedReactivation),
    "forgejo_connection_reactivation_unsupported",
  );
  assert.deepEqual(calls.slice(-3), [
    ["retire", { lifecycle: "retired" }],
    ["remove"],
    ["reactivate", { token: "replacement-pat" }],
  ]);
});
