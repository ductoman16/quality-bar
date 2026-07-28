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
        destroy() {},
        read() {
          return null;
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
});
