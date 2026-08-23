import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";
import { createGitHubVerifier } from "../src/github/github-api.js";
import { GitHubConnectionError } from "../src/github/github-connection.js";
const permissions = {
  contents: "read",
  issues: "write",
  metadata: "read",
  pull_requests: "write",
  statuses: "write",
};
test("GitHub fixture verifies the pinned profile and reactivated installation credential", async (context) => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  // prettier-ignore
  const replacementPem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  /** @type {any[]} */
  const requests = [];
  let duplicateEnumeration = false,
    repositoryAccessStatus = 0;
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://fixture.invalid");
    requests.push({
      authorization: request.headers.authorization
        ? "Bearer <redacted>"
        : undefined,
      method: request.method,
      path: `${url.pathname}${url.search}`,
      version: request.headers["x-github-api-version"],
    });
    response.setHeader("content-type", "application/json");
    /** @param {unknown} body */
    const send = (body) => response.end(JSON.stringify(body));
    if (
      request.method === "POST" &&
      url.pathname === "/app-manifests/temporary-code/conversions"
    ) {
      send({
        id: 47,
        slug: "quality-bar-personal",
        client_id: "Iv1.client",
        owner: { id: 91, login: "operator", type: "User" },
        pem,
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/app") {
      send({
        // prettier-ignore
        events: ["github_app_authorization", "installation", "installation_repositories"],
        id: 47,
        client_id: "Iv1.client",
        owner: { id: 91, login: "operator", type: "User" },
        permissions,
        slug: "quality-bar-personal",
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/app/installations") {
      send([
        {
          account: { id: 91, login: "operator", type: "User" },
          app_id: 47,
          // prettier-ignore
          events: ["github_app_authorization", "installation", "installation_repositories"],
          id: 73,
          permissions,
          repository_selection: "selected",
          suspended_at: null,
          target_type: "User",
        },
      ]);
      return;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/app/installations/73/access_tokens"
    ) {
      send({ permissions, token: "installation-token-value" });
      return;
    }
    if (
      request.method === "GET" &&
      url.pathname === "/installation/repositories"
    ) {
      send({
        repositories: duplicateEnumeration
          ? [
              {
                clone_url: "https://github.com/operator/private.git",
                full_name: "operator/private",
                html_url: "https://github.com/operator/private",
                id: 101,
                owner: { id: 91, login: "operator", type: "User" },
                private: true,
                url: "https://api.github.com/repos/operator/private",
              },
              {
                clone_url: "https://github.com/operator/private.git",
                full_name: "operator/private",
                html_url: "https://github.com/operator/private",
                id: 101,
                owner: { id: 91, login: "operator", type: "User" },
                private: true,
                url: "https://api.github.com/repos/operator/private",
              },
            ]
          : [
              {
                clone_url: "https://github.com/operator/private.git",
                full_name: "operator/private",
                html_url: "https://github.com/operator/private",
                id: 101,
                owner: { id: 91, login: "operator", type: "User" },
                private: true,
                url: "https://api.github.com/repos/operator/private",
              },
              {
                clone_url: "https://github.com/operator/public.git",
                full_name: "operator/public",
                html_url: "https://github.com/operator/public",
                id: 202,
                owner: { id: 91, login: "operator", type: "User" },
                private: false,
                url: "https://api.github.com/repos/operator/public",
              },
            ],
        total_count: 2,
      });
      return;
    }
    if (
      request.method === "GET" &&
      [
        "/repos/operator/private/branches",
        "/repos/operator/private/issues",
        "/repos/operator/private/pulls",
        "/repos/operator/public/branches",
        "/repos/operator/public/issues",
        "/repos/operator/public/pulls",
      ].includes(url.pathname)
    ) {
      if (repositoryAccessStatus) {
        response.statusCode = repositoryAccessStatus;
        send({
          message:
            repositoryAccessStatus === 403
              ? "You have exceeded a secondary rate limit."
              : "not found",
        });
        return;
      }
      send([]);
      return;
    }
    response.statusCode = 404;
    send({ message: "fixture route missing" });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(undefined));
  });
  context.after(
    () => new Promise((resolve) => server.close(() => resolve(undefined))),
  );
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  /** @type {any[]} */
  const gitReads = [];
  const verifier = createGitHubVerifier({
    apiBaseUrl: `http://127.0.0.1:${address.port}`,
    now: () => 2_000_000_000_000,
    async verifyGit(url, credential, options) {
      gitReads.push({ credential, options, url });
    },
  });
  const credential = await verifier.exchangeManifest("temporary-code");
  const verified = await verifier.verifyInstallation(credential, 73);
  const reverified = await verifier.verifyInstallation(
    { ...credential, client_id: null, pem },
    73,
  );
  assert.deepEqual(verified, {
    capabilities: {
      aggregate_feedback: "verified",
      branch_access: "verified",
      commit_status: "verified",
      enumeration: "verified",
      inline_feedback: "verified",
      private_git_read: "verified",
      pull_request_access: "verified",
    },
    principal: { id: 91, login: "operator", type: "User" },
    repositories: [
      {
        api_url: "https://api.github.com/repos/operator/private",
        clone_url: "https://github.com/operator/private.git",
        full_name: "operator/private",
        html_url: "https://github.com/operator/private",
        id: 101,
        private: true,
      },
      {
        api_url: "https://api.github.com/repos/operator/public",
        clone_url: "https://github.com/operator/public.git",
        full_name: "operator/public",
        html_url: "https://github.com/operator/public",
        id: 202,
        private: false,
      },
    ],
  });
  assert.deepEqual(reverified, verified);
  assert.deepEqual(
    gitReads.map(({ url }) => url),
    [
      ...verified.repositories.map(({ clone_url }) => clone_url),
      ...verified.repositories.map(({ clone_url }) => clone_url),
    ],
  );
  assert.ok(
    gitReads.every(
      ({ credential: gitCredential, options }) =>
        gitCredential.token === "installation-token-value" &&
        gitCredential.username === "x-access-token" &&
        JSON.stringify(options) ===
          JSON.stringify({
            definitiveHttpStatuses: [401, 403, 404],
            followRedirects: false,
          }),
    ),
  );
  gitReads.length = 0;
  const selected = await verifier.verifyRepositories(credential, 73, [101]);
  assert.deepEqual(selected, {
    affectedRepositoryIds: [101],
    capabilities: verified.capabilities,
    permissions,
    principal: verified.principal,
    repositories: [verified.repositories[0]],
    repositoryEvidence: verified.repositories,
  });
  assert.deepEqual(
    gitReads.map(({ url }) => url),
    [verified.repositories[0].clone_url],
  );
  gitReads.length = 0;
  // prettier-ignore
  assert.equal((await verifier.verifyInstallation({ ...credential, pem: replacementPem }, 73, [101])).repositories[0].id, 101);
  gitReads.length = 0;
  const selectedPublic = await verifier.verifyRepositories(
    credential,
    73,
    [202],
  );
  assert.deepEqual(selectedPublic, {
    affectedRepositoryIds: [202, 101],
    capabilities: verified.capabilities,
    permissions,
    principal: verified.principal,
    repositories: [verified.repositories[1]],
    repositoryEvidence: verified.repositories,
  });
  assert.deepEqual(
    gitReads.map((read) => read.url),
    [verified.repositories[1].clone_url, verified.repositories[0].clone_url],
  );
  gitReads.length = 0;
  repositoryAccessStatus = 404;
  await assert.rejects(
    () => verifier.verifyRepositories(credential, 73, [101]),
    (error) =>
      error instanceof GitHubConnectionError &&
      error.code === "github_repository_api_access_failed",
  );
  assert.deepEqual(gitReads, []);
  repositoryAccessStatus = 503;
  await assert.rejects(
    () => verifier.verifyRepositories(credential, 73, [101]),
    (error) =>
      error instanceof GitHubConnectionError &&
      error.code === "github_api_transient_failure",
  );
  assert.deepEqual(gitReads, []);
  repositoryAccessStatus = 403;
  await assert.rejects(
    () => verifier.verifyRepositories(credential, 73, [101]),
    (error) =>
      error instanceof GitHubConnectionError &&
      error.code === "github_api_transient_failure",
  );
  assert.deepEqual(gitReads, []);
  [repositoryAccessStatus, duplicateEnumeration] = [0, true];
  await assert.rejects(
    () => verifier.verifyRepositories(credential, 73, [101, 202]),
    (error) =>
      error instanceof GitHubConnectionError &&
      error.code === "github_repository_identity_invalid",
  );
  assert.deepEqual(gitReads, []);
  assert.ok(
    requests.every(
      ({ path, version }) =>
        path.includes("/app-manifests/") || version === "2026-03-10",
    ),
  );
  assert.ok(
    requests
      .filter(({ path }) => !path.includes("/app-manifests/"))
      .every(({ authorization }) => /^Bearer /.test(authorization ?? "")),
  );
  assert.doesNotMatch(JSON.stringify(requests), /installation-token-value/);
});
test("GitHub fixture permission drift fails before enumeration or Git access", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const verifier = createGitHubVerifier({
    fetch: async (url) => {
      const path = new URL(url).pathname;
      if (path === "/app") {
        return new Response(
          JSON.stringify({
            events: [],
            id: 47,
            client_id: "Iv1.client",
            owner: { id: 91, login: "operator", type: "User" },
            permissions: { ...permissions, contents: "write" },
            public: false,
            slug: "quality-bar-personal",
          }),
          { status: 200 },
        );
      }
      throw new Error("unexpected fixture request");
    },
    now: () => 2_000_000_000_000,
    async verifyGit() {
      throw new Error("Git must not run");
    },
  });
  await assert.rejects(
    () =>
      verifier.verifyInstallation(
        {
          app_id: 47,
          app_slug: "quality-bar-personal",
          client_id: "Iv1.client",
          owner: { id: 91, login: "operator", type: "User" },
          pem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
        },
        73,
      ),
    (error) =>
      error instanceof GitHubConnectionError &&
      error.code === "github_permissions_mismatch",
  );
});
test("GitHub fixture rejects any installation scope beyond one personal account", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const verifier = createGitHubVerifier({
    fetch: async (url) => {
      const path = new URL(url).pathname;
      if (path === "/app") {
        return new Response(
          JSON.stringify({
            events: [],
            id: 47,
            client_id: "Iv1.client",
            owner: { id: 91, login: "operator", type: "User" },
            permissions,
            public: false,
            slug: "quality-bar-personal",
          }),
          { status: 200 },
        );
      }
      if (path === "/app/installations") {
        return new Response(JSON.stringify([{ id: 73 }, { id: 74 }]), {
          status: 200,
        });
      }
      throw new Error("unexpected fixture request");
    },
    now: () => 2_000_000_000_000,
    async verifyGit() {
      throw new Error("Git must not run");
    },
  });
  await assert.rejects(
    () =>
      verifier.verifyInstallation(
        {
          app_id: 47,
          app_slug: "quality-bar-personal",
          client_id: "Iv1.client",
          owner: { id: 91, login: "operator", type: "User" },
          pem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
        },
        73,
      ),
    (error) =>
      error instanceof GitHubConnectionError &&
      error.code === "github_installation_scope_invalid",
  );
});
