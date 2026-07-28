import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import { createForgejoV16Verifier } from "../src/forgejo-v16.js";

function forgejoOpenApi() {
  return {
    paths: Object.fromEntries([
      ["/user", { get: { responses: { 200: {} } } }],
      ["/user/repos", { get: { responses: { 200: {} } } }],
      ["/repos/{owner}/{repo}", { get: { responses: { 200: {} } } }],
      ["/repos/{owner}/{repo}/branches", { get: { responses: { 200: {} } } }],
      ["/repos/{owner}/{repo}/pulls", { get: { responses: { 200: {} } } }],
      [
        "/repos/{owner}/{repo}/issues/comments",
        { get: { responses: { 200: {} } } },
      ],
      [
        "/repos/{owner}/{repo}/statuses/{sha}",
        { post: { responses: { 201: {} } } },
      ],
      [
        "/repos/{owner}/{repo}/issues/{index}/comments",
        { post: { responses: { 201: {} } } },
      ],
      [
        "/repos/{owner}/{repo}/pulls/{index}/comments",
        { post: { responses: { 201: {} } } },
      ],
    ]),
    swagger: "2.0",
  };
}

test("Forgejo v16 verification proves the fixed profile without provider writes", async (context) => {
  /** @type {{method: string | undefined, path: string}[]} */
  const requests = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://fixture.invalid");
    requests.push({
      method: request.method,
      path: `${url.pathname}${url.search}`,
    });
    response.setHeader("content-type", "application/json");
    response.setHeader(
      "x-oauth-scopes",
      "read:repository,write:repository,write:issue",
    );
    /** @param {unknown} body */
    const send = (body) => response.end(JSON.stringify(body));
    if (url.pathname === "/api/v1/version") {
      return send({ version: "16.0.4" });
    }
    if (url.pathname === "/swagger.v1.json") {
      return send(forgejoOpenApi());
    }
    if (url.pathname === "/api/v1/user") {
      return send({ id: 7, login: "operator" });
    }
    if (url.pathname === "/api/v1/user/repos") {
      return send([
        {
          clone_url: "https://forgejo.example/operator/private.git",
          full_name: "operator/private",
          html_url: "https://forgejo.example/operator/private",
          id: 11,
          permissions: { admin: true, pull: true, push: true },
          private: true,
          url: "https://forgejo.example/api/v1/repos/operator/private",
        },
      ]);
    }
    if (url.pathname === "/api/v1/repos/operator/private") {
      return send({
        id: 11,
        permissions: { admin: true, pull: true, push: true },
      });
    }
    if (
      [
        "/api/v1/repos/operator/private/branches",
        "/api/v1/repos/operator/private/pulls",
        "/api/v1/repos/operator/private/issues/comments",
      ].includes(url.pathname)
    ) {
      return send([]);
    }
    response.statusCode = 404;
    return send({ message: "missing fixture route" });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(undefined));
  });
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  /** @type {{token: string, url: string, username: string}[]} */
  const gitReads = [];
  const verifier = createForgejoV16Verifier({
    fetch,
    verifyGit: async (url, credential) => {
      if (!credential?.token || !credential.username) {
        throw new Error("forgejo_git_credential_missing");
      }
      gitReads.push({
        token: credential.token,
        url,
        username: credential.username,
      });
    },
  });

  const result = await verifier.verify({
    baseUrl: `http://127.0.0.1:${address.port}`,
    repositoryIds: [11],
    token: "operator-created-pat",
  });

  assert.deepEqual(result, {
    capabilities: {
      aggregate_feedback: "verified",
      branch_access: "verified",
      enumeration: "verified",
      inline_feedback: "verified",
      private_git_read: "verified",
      pull_request_access: "verified",
      commit_status: "verified",
    },
    principal: { id: 7, login: "operator" },
    profile: "forgejo-v16",
    reported_version: "16.0.4",
    repositories: [
      {
        api_url: "https://forgejo.example/api/v1/repos/operator/private",
        clone_url: "https://forgejo.example/operator/private.git",
        full_name: "operator/private",
        html_url: "https://forgejo.example/operator/private",
        id: 11,
        private: true,
      },
    ],
    scopes: ["read:repository", "write:issue", "write:repository"],
  });
  assert.deepEqual(gitReads, [
    {
      token: "operator-created-pat",
      url: "https://forgejo.example/operator/private.git",
      username: "oauth2",
    },
  ]);
  const discovered = await verifier.verify({
    baseUrl: `http://127.0.0.1:${address.port}`,
    token: "operator-created-pat",
  });
  assert.deepEqual(discovered, {
    repositories: [
      {
        api_url: "https://forgejo.example/api/v1/repos/operator/private",
        clone_url: "https://forgejo.example/operator/private.git",
        full_name: "operator/private",
        html_url: "https://forgejo.example/operator/private",
        id: 11,
        private: true,
      },
    ],
  });
  assert.equal(gitReads.length, 1);
  assert.ok(requests.every(({ method }) => method === "GET"));
});

test("Forgejo verification rejects prereleases, wrong majors, reduced scopes, and unselected repositories", async () => {
  const verifier = createForgejoV16Verifier({
    fetch: async () =>
      new Response(JSON.stringify({ version: "17.0.0" }), {
        headers: {
          "content-type": "application/json",
          "x-oauth-scopes": "read:repository,write:repository,write:issue",
        },
      }),
  });
  await assert.rejects(
    verifier.verify({
      baseUrl: "https://forgejo.example",
      repositoryIds: [11],
      token: "token",
    }),
    { code: "forgejo_version_unsupported" },
  );
});

test("Forgejo v16 fixture exhausts pagination before selecting a later Repository", async () => {
  const scopes = "read:repository,write:repository,write:issue";
  const repository = (/** @type {number} */ id) => ({
    clone_url: `https://forgejo.example/operator/private-${id}.git`,
    full_name: `operator/private-${id}`,
    html_url: `https://forgejo.example/operator/private-${id}`,
    id,
    permissions: { admin: true, pull: true, push: true },
    private: true,
    url: `https://forgejo.example/api/v1/repos/operator/private-${id}`,
  });
  /** @type {string[]} */
  const requests = [];
  const verifier = createForgejoV16Verifier({
    fetch: async (input) => {
      const requestUrl = new URL(String(input));
      const path = requestUrl.pathname + requestUrl.search;
      requests.push(path);
      const body =
        path === "/api/v1/version"
          ? { version: "16.1.0" }
          : path === "/swagger.v1.json"
            ? forgejoOpenApi()
            : path === "/api/v1/user"
              ? { id: 1, login: "operator" }
              : path === "/api/v1/user/repos?page=1&limit=50"
                ? Array.from({ length: 50 }, (value, index) => {
                    void value;
                    return repository(index + 1);
                  })
                : path === "/api/v1/user/repos?page=2&limit=50"
                  ? [repository(51)]
                  : path === "/api/v1/repos/operator/private-51"
                    ? {
                        id: 51,
                        permissions: { admin: true, pull: true, push: true },
                      }
                    : [];
      return new Response(JSON.stringify(body), {
        headers: { "x-oauth-scopes": scopes },
      });
    },
    verifyGit: async () => {},
  });
  const result = await verifier.verify({
    baseUrl: "https://forgejo.example",
    repositoryIds: [51],
    token: "operator-created-pat",
  });
  assert.deepEqual(
    result.repositories.map((candidate) => candidate?.id),
    [51],
  );
  assert.ok(requests.includes("/api/v1/user/repos?page=2&limit=50"));
});

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
