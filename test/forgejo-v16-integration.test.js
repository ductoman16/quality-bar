import { availableStorageReserve } from "./storage-reserve-support.js";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { createForgejoV16Verifier } from "../src/forgejo-v16.js";
import {
  createAvailableForgejoConnectionService,
  assertForgejoFailedReactivationHistory as assertFailedHistory,
  assertForgejoFailedReactivationRepository,
  assertForgejoMissingRepositoryId,
  assertForgejoPartialFailure,
  assertForgejoRepositoryFailureOwners,
  assertForgejoVerificationRows,
} from "./forgejo-v16-integration-support.js";
import { forgejoV16OpenApi } from "./forgejo-v16-openapi-support.js";

test("Forgejo v16 verification proves the fixed profile without provider writes", async (context) => {
  /** @type {{method: string | undefined, path: string}[]} */
  const requests = [];
  /** @type {number | null} */
  let forbiddenRepositoryId = null;
  /** @type {"capability" | "git" | null} */
  let repositoryFailure = null;
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
      return send(forgejoV16OpenApi());
    }
    if (url.pathname === "/api/v1/repos/search") {
      return send({
        data: [
          {
            clone_url: "https://forgejo.example/operator/private.git",
            full_name: "operator/private",
            html_url: "https://forgejo.example/operator/private",
            id: 11,
            owner: { id: 7, login: "operator" },
            permissions: { admin: true, pull: true, push: true },
            private: true,
            url: "https://forgejo.example/api/v1/repos/operator/private",
          },
          {
            clone_url: "https://forgejo.example/operator/private-2.git",
            full_name: "operator/private-2",
            html_url: "https://forgejo.example/operator/private-2",
            id: 12,
            owner: { id: 7, login: "operator" },
            permissions: { admin: true, pull: true, push: true },
            private: true,
            url: "https://forgejo.example/api/v1/repos/operator/private-2",
          },
        ],
        ok: true,
      });
    }
    if (url.pathname === "/api/v1/repos/operator/private") {
      return send({
        id: 11,
        permissions:
          repositoryFailure === "capability"
            ? { admin: false, pull: true, push: true }
            : { admin: true, pull: true, push: true },
      });
    }
    if (url.pathname === "/api/v1/repos/operator/private-2") {
      return send({
        id: 12,
        permissions: { admin: true, pull: true, push: true },
      });
    }
    if (
      [
        "/api/v1/repos/operator/private/branches",
        "/api/v1/repos/operator/private/pulls",
        "/api/v1/repos/operator/private/issues/comments",
        "/api/v1/repos/operator/private-2/branches",
        "/api/v1/repos/operator/private-2/pulls",
        "/api/v1/repos/operator/private-2/issues/comments",
      ].includes(url.pathname)
    ) {
      if (
        forbiddenRepositoryId !== null &&
        url.pathname.includes(
          forbiddenRepositoryId === 11 ? "/private/" : "/private-2/",
        ) &&
        url.pathname.endsWith("/branches")
      ) {
        response.statusCode = 403;
        return send({ message: "forbidden" });
      }
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
      if (repositoryFailure === "git") {
        throw Object.assign(new Error("Forgejo Repository Git read failed"), {
          code: "repository_git_read_failed",
        });
      }
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
        outcome: "success",
        permissions: { admin: true, pull: true, push: true },
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
  await assertForgejoMissingRepositoryId(
    verifier,
    `http://127.0.0.1:${address.port}`,
  );
  const emptySelectionRequestIndex = requests.length;
  const emptySelection = await verifier.verify({
    baseUrl: `http://127.0.0.1:${address.port}`,
    repositoryIds: [],
    token: "operator-created-pat",
  });
  assert.deepEqual(emptySelection, {
    capabilities: {
      aggregate_feedback: "not_completed",
      branch_access: "not_completed",
      commit_status: "not_completed",
      enumeration: "verified",
      inline_feedback: "not_completed",
      private_git_read: "not_completed",
      pull_request_access: "not_completed",
    },
    principal: { id: 7, login: "operator" },
    profile: "forgejo-v16",
    reported_version: "16.0.4",
    repositories: [],
    scopes: ["read:repository", "write:issue", "write:repository"],
  });
  assert.deepEqual(requests.slice(emptySelectionRequestIndex), [
    { method: "GET", path: "/api/v1/version" },
    { method: "GET", path: "/swagger.v1.json" },
    {
      method: "GET",
      path: "/api/v1/repos/search?page=1&limit=50&private=true",
    },
  ]);
  assert.equal(gitReads.length, 1);
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
        permissions: { admin: true, pull: true, push: true },
        private: true,
      },
      {
        api_url: "https://forgejo.example/api/v1/repos/operator/private-2",
        clone_url: "https://forgejo.example/operator/private-2.git",
        full_name: "operator/private-2",
        html_url: "https://forgejo.example/operator/private-2",
        id: 12,
        permissions: { admin: true, pull: true, push: true },
        private: true,
      },
    ],
  });
  assert.equal(gitReads.length, 1);
  await assertForgejoRepositoryFailureOwners(
    verifier,
    `http://127.0.0.1:${address.port}`,
    (failure) => {
      repositoryFailure = failure;
    },
  );
  forbiddenRepositoryId = 11;
  await assert.rejects(
    verifier.verify({
      baseUrl: `http://127.0.0.1:${address.port}`,
      repositoryIds: [11],
      token: "operator-created-pat",
    }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.equal(
        /** @type {any} */ (error).code,
        "forgejo_repository_permission_denied",
      );
      assert.equal(/** @type {any} */ (error).repositoryId, 11);
      return true;
    },
  );
  forbiddenRepositoryId = 12;
  /** @type {any} */
  let partialFailure;
  try {
    await verifier.verify({
      baseUrl: `http://127.0.0.1:${address.port}`,
      repositoryIds: [11, 12],
      token: "operator-created-pat",
    });
  } catch (error) {
    partialFailure = error;
  }
  assertForgejoPartialFailure(partialFailure);
  forbiddenRepositoryId = null;
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-forgejo-v16-rotation-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  const service = createAvailableForgejoConnectionService(core, {
    storageReserve: availableStorageReserve,
    createId: (() => {
      const ids = [
        "connection-1",
        "verification-1",
        "repository-1",
        "verification-2",
        "verification-3",
        "verification-4",
      ];
      return () => ids.shift();
    })(),
    masterKey: Buffer.alloc(32, 6),
    now: (() => {
      let timestamp = 1_000;
      return () => timestamp++;
    })(),
    verifier,
  });
  await service.connect({
    base_url: `http://127.0.0.1:${address.port}`,
    repository_ids: [11],
    token: "original-pat",
  });
  await service.rotate({ token: "replacement-pat" });
  core.run(
    "UPDATE repositories SET lifecycle = 'retired' WHERE id = 'repository-1'",
  );
  service.retire({ lifecycle: "retired" });
  forbiddenRepositoryId = 11;
  await assert.rejects(
    service.reactivate({ token: "failed-reactivation-pat" }),
    { code: "forgejo_repository_permission_denied", repositoryId: 11 },
  );
  assertFailedHistory(service.read()?.verification_history.at(-1));
  assertForgejoFailedReactivationRepository(core);
  forbiddenRepositoryId = null;
  await service.reactivate({ token: "reactivation-pat" });
  assert.deepEqual(
    gitReads.slice(-3).map(({ token }) => token),
    ["original-pat", "replacement-pat", "reactivation-pat"],
  );
  assertForgejoVerificationRows(core);
  service.destroy();
  core.close();
  assert.ok(requests.every(({ method }) => method === "GET"));
});

test("Forgejo verification rejects unsupported versions before Repository access", async () => {
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
  const repository = (/** @type {number} */ id) => ({
    clone_url: `https://forgejo.example/operator/private-${id}.git`,
    full_name: `operator/private-${id}`,
    html_url: `https://forgejo.example/operator/private-${id}`,
    id,
    owner: { id: 1, login: "operator" },
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
            ? forgejoV16OpenApi()
            : path === "/api/v1/repos/search?page=1&limit=50&private=true"
              ? {
                  data: Array.from({ length: 50 }, (value, index) => {
                    void value;
                    return repository(index + 1);
                  }),
                  ok: true,
                }
              : path === "/api/v1/repos/search?page=2&limit=50&private=true"
                ? { data: [repository(51)], ok: true }
                : path === "/api/v1/repos/operator/private-51"
                  ? {
                      id: 51,
                      permissions: { admin: true, pull: true, push: true },
                    }
                  : [];
      return new Response(JSON.stringify(body));
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
  assert.ok(
    requests.includes("/api/v1/repos/search?page=2&limit=50&private=true"),
  );
});
