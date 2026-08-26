import assert from "node:assert/strict";
import { test } from "node:test";

import { createForgejoVerifier } from "../src/forgejo/forgejo-verifier.ts";
import { forgejoResponseFailure } from "../src/forgejo/forgejo-response-failure.ts";
import { forgejoOpenApi } from "./forgejo-openapi-support.ts";

test("Forgejo fixture rejects redirects and reports transport failures with owned codes", async () => {
  const verifier = createForgejoVerifier({
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

test("Forgejo verification preserves authentication and provider rate semantics", async () => {
  const cases: [number, Record<string, string>, Record<string, unknown>][] = [
    [
      401,
      {},
      { code: "forgejo_connection_credential_invalid", responseStatus: 401 },
    ],
    [
      429,
      { "retry-after": "120" },
      {
        code: "forgejo_api_rate_limited",
        nextAttemptAt: 121_000,
        responseStatus: 429,
      },
    ],
  ];
  for (const [status, headers, expected] of cases) {
    const verifier = createForgejoVerifier({
      fetch: async () => new Response("{}", { headers, status }),
      now: () => 1_000,
    });
    await assert.rejects(
      verifier.verify({
        baseUrl: "https://forgejo.example",
        repositoryIds: [1],
        token: "operator-created-pat",
      }),
      expected,
    );
  }
});

test("Forgejo verification makes incompatible required routes definitive at their exact scope", () => {
  const response = new Response("{}", { status: 405 });
  assert.deepEqual(
    forgejoResponseFailure(
      response,
      "/api/v1/version",
      "verification",
      undefined,
    ),
    Object.assign(
      new Error(
        "Forgejo verification route failed with HTTP 405: /api/v1/version",
      ),
      {
        code: "forgejo_required_route_unavailable",
        responseStatus: 405,
      },
    ),
  );
  assert.equal(
    forgejoResponseFailure(
      response,
      "/api/v1/repos/operator/repository/branches",
      "verification",
      11,
    ).code,
    "forgejo_repository_capability_missing",
  );
});

test("Forgejo fixture rejects missing pinned OpenAPI route evidence", async () => {
  const verifier = createForgejoVerifier({
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

test("Forgejo fixture rejects ambiguous principal enumeration", async () => {
  const verifier = createForgejoVerifier({
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

test("Forgejo enumeration capability failure retains its Repository owner", async () => {
  const verifier = createForgejoVerifier({
    fetch: async (input) => {
      const path = new URL(String(input)).pathname;
      const body =
        path === "/api/v1/version"
          ? { version: "16.0.4" }
          : path === "/swagger.v1.json"
            ? forgejoOpenApi()
            : {
                data: [
                  {
                    clone_url:
                      "https://forgejo.example/operator/repository.git",
                    full_name: "operator/repository",
                    html_url: "https://forgejo.example/operator/repository",
                    id: 11,
                    owner: { id: 7, login: "operator" },
                    permissions: { admin: false, pull: true, push: true },
                    private: true,
                    url: "https://forgejo.example/api/v1/repos/operator/repository",
                  },
                ],
                ok: true,
              };
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
      repositoryIds: [11],
      token: "operator-created-pat",
    }),
    { code: "forgejo_repository_capability_missing", repositoryId: 11 },
  );
});

test("Forgejo fixture preserves exact evidence when pagination fails", async () => {
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
  const verifier = createForgejoVerifier({
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
            ? forgejoOpenApi()
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
      const failure = error as Error & {
        code?: string;
        verificationEvidence?: unknown;
      };
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
        profile: "forgejo",
        reported_version: "16.0.4",
        repositories: [{ forge_repository_id: 1, outcome: "not_completed" }],
        scopes: ["read:repository", "write:issue", "write:repository"],
      });
      return true;
    },
  );
});
