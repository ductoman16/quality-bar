import assert from "node:assert/strict";
import { test } from "node:test";

import { createForgejoV16Verifier } from "../src/forgejo-v16.js";
import { forgejoV16OpenApi } from "./forgejo-v16-openapi-support.js";

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
            ? forgejoV16OpenApi()
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

test("Forgejo v16 fixture preserves exact evidence when pagination fails", async () => {
  const repositories = [...Array(50).keys()].map((index) => {
    const id = index + 1;
    return {
      clone_url: `https://forgejo.example/operator/repository-${id}.git`,
      full_name: `operator/repository-${id}`,
      html_url: `https://forgejo.example/operator/repository-${id}`,
      id,
      owner: { id: 7, login: "operator" },
      permissions: { admin: true, pull: true, push: true },
      private: true,
      url: `https://forgejo.example/api/v1/repos/operator/repository-${id}`,
    };
  });
  const verifier = createForgejoV16Verifier({
    fetch: async (input) => {
      const url = new URL(String(input));
      if (
        url.pathname === "/api/v1/repos/search" &&
        url.searchParams.get("page") === "2"
      ) {
        throw new Error("second page offline");
      }
      const body =
        url.pathname === "/api/v1/version"
          ? { version: "16.0.4" }
          : url.pathname === "/swagger.v1.json"
            ? forgejoV16OpenApi()
            : { data: repositories, ok: true };
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
    (error) => {
      assert.ok(error instanceof Error);
      const failure =
        /** @type {Error & {code?: string, verificationEvidence?: unknown}} */ (
          error
        );
      assert.equal(failure.code, "forgejo_api_unavailable");
      assert.deepEqual(failure.verificationEvidence, {
        capabilities: {
          aggregate_feedback: "not_completed",
          branch_access: "not_completed",
          commit_status: "not_completed",
          enumeration: "error",
          inline_feedback: "not_completed",
          private_git_read: "not_completed",
          pull_request_access: "not_completed",
        },
        principal: { id: 7, login: "operator" },
        profile: "forgejo-v16",
        reported_version: "16.0.4",
        repositories: [{ forge_repository_id: 1, outcome: "not_completed" }],
        scopes: ["read:repository", "write:issue", "write:repository"],
      });
      return true;
    },
  );
});
