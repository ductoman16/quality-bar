import assert from "node:assert/strict";
import { test } from "node:test";

import { createForgejoV16Verifier } from "../src/forgejo-v16.js";

function forgejoOpenApi() {
  const operations = [
    ["/repos/search", "get", "200"],
    ["/repos/{owner}/{repo}", "get", "200"],
    ["/repos/{owner}/{repo}/branches", "get", "200"],
    ["/repos/{owner}/{repo}/pulls", "get", "200"],
    ["/repos/{owner}/{repo}/issues/comments", "get", "200"],
    ["/repos/{owner}/{repo}/statuses/{sha}", "post", "201"],
    ["/repos/{owner}/{repo}/issues/{index}/comments", "post", "201"],
    ["/repos/{owner}/{repo}/pulls/{index}/reviews", "post", "200"],
  ];
  return {
    paths: Object.fromEntries(
      operations.map(([path, method, status]) => [
        path,
        { [method]: { responses: { [status]: {} } } },
      ]),
    ),
    swagger: "2.0",
  };
}

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

test("Forgejo v16 fixture rejects ambiguous principal enumeration", async () => {
  const verifier = createForgejoV16Verifier({
    fetch: async (input) => {
      const path = new URL(String(input)).pathname;
      const body =
        path === "/api/v1/version"
          ? { version: "16.0.4" }
          : path === "/swagger.v1.json"
            ? forgejoOpenApi()
            : {
                data: [7, 8].map((id) => ({
                  clone_url: `https://forgejo.example/operator/repository-${id}.git`,
                  full_name: `operator/repository-${id}`,
                  html_url: `https://forgejo.example/operator/repository-${id}`,
                  id,
                  owner: { id, login: `operator-${id}` },
                  permissions: { admin: true, pull: true, push: true },
                  private: true,
                  url: `https://forgejo.example/api/v1/repos/operator/repository-${id}`,
                })),
                ok: true,
              };
      return new Response(JSON.stringify(body), {
        headers: { "content-type": "application/json" },
      });
    },
  });
  await assert.rejects(
    verifier.verify({
      baseUrl: "https://forgejo.example",
      repositoryIds: [1],
      token: "operator-created-pat",
    }),
    { code: "forgejo_principal_invalid" },
  );
});
