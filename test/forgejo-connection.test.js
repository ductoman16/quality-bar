import assert from "node:assert/strict";
import { test } from "node:test";

import { createForgejoV16Verifier } from "../src/forgejo-v16.js";
import { createForgejoConnectionService } from "../src/forgejo-connection.js";

test("Forgejo v16 verifier rejects an inferred repository selection before any request", async () => {
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
    { code: "forgejo_verification_request_invalid" },
  );
  assert.equal(requested, false);
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
