import { availableStorageReserve } from "./storage-reserve-support.js";
import assert from "node:assert/strict";
import { test } from "node:test";

import { createForgejoV16Verifier } from "../src/forgejo-v16.js";
import { createForgejoConnectionService } from "../src/forgejo-connection.js";

test("Forgejo v16 verifier begins provider proof for an explicit empty repository selection", async () => {
  let requested = false;
  const verifier = createForgejoV16Verifier({
    fetch: async () => {
      requested = true;
      return new Response();
    },
  });
  await assert.rejects(
    verifier.verify({
      baseUrl: "https://forgejo.example",
      repositoryIds: [],
      token: "operator-created-pat",
    }),
    { code: "forgejo_api_response_invalid" },
  );
  assert.equal(requested, true);
});

test("Forgejo v16 verifier rejects malformed selection, token, and endpoint inputs before provider access", async () => {
  let requested = false;
  const verifier = createForgejoV16Verifier({
    fetch: async () => {
      requested = true;
      return new Response();
    },
  });
  const cases = [
    {
      baseUrl: "https://forgejo.example",
      repositoryIds: [1, 1],
      token: "pat",
      code: "forgejo_verification_request_invalid",
    },
    {
      baseUrl: "https://forgejo.example",
      repositoryIds: [0],
      token: "pat",
      code: "forgejo_verification_request_invalid",
    },
    {
      baseUrl: "https://forgejo.example",
      repositoryIds: ["1"],
      token: "pat",
      code: "forgejo_verification_request_invalid",
    },
    {
      baseUrl: "https://forgejo.example",
      repositoryIds: [1],
      token: "",
      code: "forgejo_verification_request_invalid",
    },
    {
      baseUrl: "not a URL",
      repositoryIds: [1],
      token: "pat",
      code: "forgejo_url_invalid",
    },
    {
      baseUrl: "ftp://forgejo.example",
      repositoryIds: [1],
      token: "pat",
      code: "forgejo_url_invalid",
    },
    {
      baseUrl: "https://forgejo.example?unexpected=true",
      repositoryIds: [1],
      token: "pat",
      code: "forgejo_url_invalid",
    },
    {
      baseUrl: "https://forgejo.example#unexpected",
      repositoryIds: [1],
      token: "pat",
      code: "forgejo_url_invalid",
    },
    {
      baseUrl: "https://operator@forgejo.example",
      repositoryIds: [1],
      token: "pat",
      code: "forgejo_url_invalid",
    },
    {
      baseUrl: "https://:secret@forgejo.example",
      repositoryIds: [1],
      token: "pat",
      code: "forgejo_url_invalid",
    },
    {
      baseUrl: "https://forgejo.example/path",
      repositoryIds: [1],
      token: "pat",
      code: "forgejo_url_invalid",
    },
    {
      baseUrl: "https://forgejo.example",
      repositoryIds: "1",
      token: "pat",
      code: "forgejo_verification_request_invalid",
    },
    {
      baseUrl: "https://forgejo.example",
      repositoryIds: [1],
      token: 1,
      code: "forgejo_verification_request_invalid",
    },
    {
      baseUrl: "https://forgejo.example/api",
      repositoryIds: [1],
      token: "pat",
      code: "forgejo_url_invalid",
    },
  ];
  for (const { code, ...input } of cases) {
    await assert.rejects(verifier.verify(/** @type {any} */ (input)), { code });
  }
  assert.equal(requested, false);
});

test("Forgejo Connection construction rejects every incomplete owned dependency", () => {
  const validCore = { all: () => [], transaction() {} };
  for (const [core, options] of [
    [null, { masterKey: Buffer.alloc(32) }],
    [{ transaction() {} }, { masterKey: Buffer.alloc(32) }],
    [{ all: () => [] }, { masterKey: Buffer.alloc(32) }],
    [validCore, { createId: null, masterKey: Buffer.alloc(32) }],
    [validCore, { masterKey: Buffer.alloc(32), now: null }],
    [validCore, { masterKey: Buffer.alloc(32), verifier: null }],
  ]) {
    assert.throws(
      () =>
        createForgejoConnectionService(
          /** @type {any} */ (core),
          /** @type {any} */ (options),
        ),
      /Forgejo Connection dependencies are invalid/,
    );
  }
});

test("Forgejo PAT rotation rejects an empty replacement before reading or verifying", async () => {
  let reads = 0;
  let verifications = 0;
  const service = createForgejoConnectionService(
    {
      all() {
        reads += 1;
        return [];
      },
      transaction() {
        throw new Error("unused transaction");
      },
    },
    {
      storageReserve: availableStorageReserve,
      masterKey: Buffer.alloc(32),
      verifier: {
        async listPullRequests() {
          return [];
        },
        async verify() {
          verifications += 1;
        },
      },
    },
  );
  await assert.rejects(() => service.rotate({ token: "" }), {
    code: "forgejo_connection_rotation_request_invalid",
  });
  assert.equal(reads, 1);
  assert.equal(verifications, 0);
  service.destroy();
});

test("Forgejo Connection read rejects contradictory durable health errors", () => {
  const baseRow = {
    api_profile: "forgejo-v16",
    base_url: "https://forgejo.example",
    capabilities: "{}",
    health: "healthy",
    health_error_code: null,
    health_error_message: null,
    id: "connection-1",
    lifecycle: "enabled",
    principal_id: 7,
    principal_login: "operator",
    reported_version: "16.0.4",
    scopes: "[]",
    verified_at: 1_000,
  };
  for (const row of [
    {
      ...baseRow,
      health_error_code: "stale",
      health_error_message: "stale",
    },
    {
      ...baseRow,
      health: "error",
      health_error_message: "Missing code",
    },
    {
      ...baseRow,
      health: "error",
      health_error_code: "missing_message",
    },
    { ...baseRow, health: "unknown" },
  ]) {
    const service = createForgejoConnectionService(
      {
        all(sql) {
          return sql.includes("forgejo_connection_credentials") ||
            sql.includes("quality_bar_metadata") ||
            sql.includes("forgejo_repository_polls")
            ? []
            : [row];
        },
        transaction() {
          throw new Error("unused transaction");
        },
      },
      {
        storageReserve: availableStorageReserve,
        masterKey: Buffer.alloc(32),
        verifier: {
          async listPullRequests() {
            return [];
          },
          async verify() {},
        },
      },
    );
    assert.throws(() => service.read(), /Forgejo Connection/);
    service.destroy();
  }
});
