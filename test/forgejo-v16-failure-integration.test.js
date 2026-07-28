import assert from "node:assert/strict";
import { test } from "node:test";

import { createForgejoV16Verifier } from "../src/forgejo-v16.js";

test("Forgejo v16 fixture rejects redirects and reports transport failures with owned codes", async () => {
  const verifier = createForgejoV16Verifier({
    fetch: async (...arguments_) => {
      const options = arguments_[1];
      assert.equal(options?.redirect, "error");
      throw new Error("redirected or offline");
    },
  });
  await assert.rejects(
    verifier.verify({
      baseUrl: "https://forgejo.example",
      repositoryIds: [1],
      token: "operator-created-pat",
    }),
    { code: "forgejo_api_unavailable" },
  );
});

test("Forgejo v16 fixture rejects missing pinned OpenAPI route evidence", async () => {
  const verifier = createForgejoV16Verifier({
    fetch: async (input) => {
      const path = new URL(String(input)).pathname;
      const body =
        path === "/api/v1/version"
          ? { version: "16.0.4" }
          : { paths: {}, swagger: "2.0" };
      return new Response(JSON.stringify(body), {
        headers: {
          "content-type": "application/json",
          "x-oauth-scopes": "read:repository,write:repository,write:issue",
        },
      });
    },
  });
  await assert.rejects(
    verifier.verify({
      baseUrl: "https://forgejo.example",
      repositoryIds: [1],
      token: "operator-created-pat",
    }),
    { code: "forgejo_openapi_invalid" },
  );
});

test("Forgejo v16 fixture rejects a reduced PAT scope before profile inference", async () => {
  const verifier = createForgejoV16Verifier({
    fetch: async () =>
      new Response(JSON.stringify({ version: "16.0.4" }), {
        headers: {
          "content-type": "application/json",
          "x-oauth-scopes": "read:repository,write:repository",
        },
      }),
  });
  await assert.rejects(
    verifier.verify({
      baseUrl: "https://forgejo.example",
      repositoryIds: [1],
      token: "operator-created-pat",
    }),
    { code: "forgejo_scopes_mismatch" },
  );
});
