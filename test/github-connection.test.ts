import {
  availableStorageReserve,
  createAvailableGitHubConnectionService as createGitHubConnectionService,
} from "./storage-reserve-support.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

import { GitHubConnectionError } from "../src/github/github-connection.ts";

function createCore() {
  const writes: any[] = [];
  return {
    writes,
    all(sql: string): any[] {
      void sql;
      return [];
    },
    get() {
      return undefined;
    },
    transaction(callback: (transaction: any) => any) {
      return callback({
        run(sql: string, ...parameters: Array<any>) {
          writes.push({ parameters, sql });
          return { changes: 1 };
        },
      });
    },
  };
}

test("manifest and installation callbacks atomically create one verified secret-free GitHub Connection", async () => {
  const core = createCore();
  const calls: any[] = [];
  const service = createGitHubConnectionService(core, {
    storageReserve: availableStorageReserve,
    createId: (() => {
      const ids = ["connection-1", "verification-1"];
      return () => ids.shift();
    })(),
    externalOrigin: "https://quality-bar.example",
    masterKey: Buffer.alloc(32, 7),
    now: () => 1_000,
    randomBytes: () => Buffer.alloc(32, 5),
    verifier: {
      listPullRequests: async () => [],
      async exchangeManifest(code) {
        calls.push(["exchange", code]);
        return {
          app_id: 47,
          app_slug: "quality-bar-personal",
          client_id: "Iv1.client",
          owner: { id: 91, login: "operator", type: "User" },
          pem: "private-key-value",
        };
      },
      async verifyInstallation(credential, installationId) {
        calls.push(["verify", credential, installationId]);
        return {
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
              id: 101,
              full_name: "operator/private",
              html_url: "https://github.com/operator/private",
              private: true,
            },
          ],
        };
      },
      async verifyRepositories() {
        throw new Error("repository selection is not exercised");
      },
    },
  });

  const started = service.start();
  assert.equal(
    started.action,
    `https://github.com/settings/apps/new?state=${started.state}`,
  );
  assert.equal(started.method, "POST");
  assert.match(started.state, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(started.manifest.default_events, []);
  const installationUrl = await service.completeManifest({
    code: "temporary-code",
    state: started.state,
  });
  assert.equal(
    installationUrl,
    "https://github.com/apps/quality-bar-personal/installations/new",
  );
  const connection = await service.completeInstallation({
    installationId: "73",
    state: started.state,
  });

  assert.deepEqual(calls, [
    ["exchange", "temporary-code"],
    [
      "verify",
      {
        app_id: 47,
        app_slug: "quality-bar-personal",
        client_id: "Iv1.client",
        owner: { id: 91, login: "operator", type: "User" },
        pem: "private-key-value",
      },
      73,
    ],
  ]);
  assert.deepEqual(connection, {
    api_profile: "github-rest:2026-03-10",
    app_id: 47,
    app_slug: "quality-bar-personal",
    capabilities: {
      aggregate_feedback: "verified",
      branch_access: "verified",
      commit_status: "verified",
      enumeration: "verified",
      inline_feedback: "verified",
      private_git_read: "verified",
      pull_request_access: "verified",
    },
    health: "healthy",
    health_error: null,
    id: "connection-1",
    lifecycle: "enabled",
    permissions: {
      contents: "read",
      issues: "write",
      metadata: "read",
      pull_requests: "write",
      statuses: "write",
    },
    polling: [],
    polling_failure: null,
    principal: { id: 91, login: "operator", type: "User" },
    repository_count: 1,
    verification_history: [
      {
        affected_repository_ids: [101],
        api_profile: "github-rest:2026-03-10",
        capabilities: {
          aggregate_feedback: "verified",
          branch_access: "verified",
          commit_status: "verified",
          enumeration: "verified",
          inline_feedback: "verified",
          private_git_read: "verified",
          pull_request_access: "verified",
        },
        error: null,
        id: "verification-1",
        outcome: "success",
        permissions: {
          contents: "read",
          issues: "write",
          metadata: "read",
          pull_requests: "write",
          statuses: "write",
        },
        principal: { id: 91, login: "operator", type: "User" },
        repositories: [
          {
            api_url: "https://api.github.com/repos/operator/private",
            clone_url: "https://github.com/operator/private.git",
            id: 101,
            full_name: "operator/private",
            html_url: "https://github.com/operator/private",
            private: true,
          },
        ],
        repository_checks: [{ outcome: "success", repository_id: 101 }],
        trigger: "onboarding",
        verified_at: 1_000,
      },
    ],
    verified_at: 1_000,
  });
  assert.equal(core.writes.length, 3);
  const storedText = JSON.stringify(core.writes);
  assert.doesNotMatch(storedText, /private-key-value|temporary-code/);
  assert.match(storedText, /verification-1/);
});

test("failed or replayed GitHub onboarding stores nothing and returns one exact error", async () => {
  const core = createCore();
  const service = createGitHubConnectionService(core, {
    storageReserve: availableStorageReserve,
    externalOrigin: "https://quality-bar.example",
    masterKey: Buffer.alloc(32, 7),
    now: () => 1_000,
    randomBytes: () => Buffer.alloc(32, 6),
    verifier: {
      listPullRequests: async () => [],
      async exchangeManifest() {
        throw new GitHubConnectionError(
          "github_manifest_exchange_failed",
          "GitHub App Manifest exchange failed",
        );
      },
      async verifyInstallation() {
        throw new Error("unreachable");
      },
      async verifyRepositories() {
        throw new Error("unreachable");
      },
    },
  });
  const started = service.start();
  await assert.rejects(
    () =>
      service.completeManifest({
        code: "temporary-code",
        state: started.state,
      }),
    (error) =>
      error instanceof GitHubConnectionError &&
      error.code === "github_manifest_exchange_failed",
  );
  await assert.rejects(
    () =>
      service.completeManifest({
        code: "temporary-code",
        state: started.state,
      }),
    (error) =>
      error instanceof GitHubConnectionError &&
      error.code === "github_manifest_state_invalid",
  );
  assert.deepEqual(core.writes, []);
});

test("retired GitHub Connection reactivation verifies the same App replacement key before persistence", async () => {
  const core = createCore();
  core.all = (sql) => {
    if (sql.includes("SELECT id, app_id, app_slug")) {
      return [
        {
          app_id: 47,
          app_slug: "quality-bar-personal",
          id: "connection-1",
          installation_id: 73,
          lifecycle: "retired",
          principal_id: 91,
          principal_login: "operator",
        },
      ];
    }
    return [];
  };
  const verificationCalls: any[] = [];
  const service = createGitHubConnectionService(core, {
    storageReserve: availableStorageReserve,
    externalOrigin: "https://quality-bar.example",
    masterKey: Buffer.alloc(32, 7),
    randomBytes: () => Buffer.alloc(32, 5),
    verifier: {
      listPullRequests: async () => [],
      async exchangeManifest() {
        throw new Error("reactivation must not exchange a GitHub App Manifest");
      },
      async verifyInstallation(credential, installationId) {
        verificationCalls.push([credential, installationId]);
        throw new GitHubConnectionError(
          "github_permissions_mismatch",
          "GitHub App permissions do not match the required profile",
        );
      },
      async verifyRepositories() {
        throw new Error("repository selection is not exercised");
      },
    },
  });
  await assert.rejects(
    () => service.reactivate({ pem: "replacement-private-key" }),
    (error) =>
      error instanceof GitHubConnectionError &&
      error.code === "github_permissions_mismatch",
  );
  assert.deepEqual(verificationCalls, [
    [
      {
        app_id: 47,
        app_slug: "quality-bar-personal",
        client_id: null,
        owner: { id: 91, login: "operator", type: "User" },
        pem: "replacement-private-key",
      },
      73,
    ],
  ]);
  assert.deepEqual(core.writes, []);
});

test("a retired GitHub Connection rejects a new App Manifest flow", () => {
  const core = createCore();
  core.all = (sql) =>
    sql.includes("SELECT lifecycle") ? [{ lifecycle: "retired" }] : [];
  const service = createGitHubConnectionService(core, {
    storageReserve: availableStorageReserve,
    externalOrigin: "https://quality-bar.example",
    masterKey: Buffer.alloc(32, 7),
  });
  assert.throws(
    () => service.start(),
    (error) =>
      error instanceof GitHubConnectionError &&
      error.code === "github_connection_conflict" &&
      error.message ===
        "A retired GitHub Connection must be reactivated with a replacement private key",
  );
});
