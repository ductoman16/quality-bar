import {
  availableStorageReserve,
  createAvailableGitHubConnectionService as createGitHubConnectionService,
} from "./storage-reserve-support.ts";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { GitHubConnectionError } from "../src/github/github-connection.ts";
import { openDurableCore } from "../src/durable/durable-core.ts";

const verifiedInstallation: any = {
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
  ],
};

const convertedApp: any = {
  app_id: 47,
  app_slug: "quality-bar-personal",
  client_id: "Iv1.client",
  owner: { id: 91, login: "operator", type: "User" },
  pem: "private-key-value",
};

test("SQLite atomically stores one encrypted GitHub Connection and immutable secret-free verification", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-github-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const databasePath = join(directory, "quality-bar.sqlite3");
  const core = openDurableCore(databasePath);
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
      async createInstallationToken(credential, installationId) {
        assert.equal(credential.pem, "private-key-value");
        assert.equal(installationId, 73);
        return "short-lived-installation-token";
      },
      listPullRequests: async () => [],
      async exchangeManifest() {
        return convertedApp;
      },
      async verifyInstallation() {
        return verifiedInstallation;
      },
      async verifyRepositories() {
        throw new Error("repository selection is not exercised");
      },
    },
  });
  const started = service.start();
  await service.completeManifest({ code: "code", state: started.state });
  const completed = await service.completeInstallation({
    installationId: "73",
    state: started.state,
  });
  assert.ok(completed);
  assert.deepEqual(service.read(), completed);
  const gitCredential =
    await service.acquireRepositoryGitCredential("connection-1");
  assert.equal(gitCredential.token, "short-lived-installation-token");
  assert.equal(gitCredential.username, "x-access-token");

  assert.equal(
    core.get("SELECT count(*) AS count FROM github_connections")?.count,
    1,
  );
  const credential = core.get(
    "SELECT encrypted_credential FROM github_connection_credentials",
  ) as { encrypted_credential: string };
  assert.match(credential.encrypted_credential, /^v1\./);
  assert.doesNotMatch(
    credential.encrypted_credential,
    /private-key-value|Iv1\.client/,
  );
  const verification = core.get(
    `SELECT
       id, trigger, api_profile, principal_login,
       permissions, capabilities, repositories, verified_at
     FROM github_connection_verifications`,
  );
  assert.deepEqual(verification, {
    api_profile: "github-rest:2026-03-10",
    capabilities: JSON.stringify(verifiedInstallation.capabilities),
    id: "verification-1",
    permissions: JSON.stringify({
      contents: "read",
      issues: "write",
      metadata: "read",
      pull_requests: "write",
      statuses: "write",
    }),
    principal_login: "operator",
    repositories: JSON.stringify(verifiedInstallation.repositories),
    trigger: "onboarding",
    verified_at: 1_000,
  });
  assert.doesNotMatch(JSON.stringify(verification), /private-key-value/);
  assert.throws(
    () =>
      core.run("UPDATE github_connection_verifications SET verified_at = 1001"),
    /github_connection_verification_immutable/,
  );
  assert.throws(
    () => core.run("DELETE FROM github_connection_verifications"),
    /github_connection_verification_immutable/,
  );
  service.destroy();
  core.close();

  const reopened = openDurableCore(databasePath);
  const reopenedService = createGitHubConnectionService(reopened, {
    storageReserve: availableStorageReserve,
    externalOrigin: "https://quality-bar.example",
    masterKey: Buffer.alloc(32, 7),
  });
  assert.deepEqual(reopenedService.read(), completed);
  reopenedService.destroy();
  reopened.close();

  const wrongKeyCore = openDurableCore(databasePath);
  assert.throws(
    () =>
      createGitHubConnectionService(wrongKeyCore, {
        storageReserve: availableStorageReserve,
        externalOrigin: "https://quality-bar.example",
        masterKey: Buffer.alloc(32, 8),
      }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "github_connection_credential_undecryptable",
  );
  wrongKeyCore.close();

  const lifecycleCore = openDurableCore(databasePath);
  lifecycleCore.run(
    `INSERT INTO repositories (
       id, normalized_url, lifecycle, created_at, verified_at
     ) VALUES (?, ?, 'retired', ?, ?)`,
    "repository-1",
    "https://github.com/operator/private.git",
    1_000,
    1_000,
  );
  lifecycleCore.run(
    `INSERT INTO github_repositories (
       repository_id, connection_id, forge_repository_id, name,
       api_url, web_url, verification_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    "repository-1",
    "connection-1",
    101,
    "operator/private",
    "https://api.github.com/repos/operator/private",
    "https://github.com/operator/private",
    "verification-1",
  );
  lifecycleCore.run(
    `INSERT INTO github_repository_polls (
       connection_id, forge_repository_id, baseline_status,
       last_success_at, next_attempt_at, snapshot
     ) VALUES (?, ?, 'complete', ?, ?, ?)`,
    "connection-1",
    101,
    1_000,
    61_000,
    "[]",
  );
  let baselineRequests = 0;
  const lifecycleService = createGitHubConnectionService(lifecycleCore, {
    storageReserve: availableStorageReserve,
    createId: (() => {
      const ids = ["verification-2"];
      return () => ids.shift();
    })(),
    externalOrigin: "https://quality-bar.example",
    masterKey: Buffer.alloc(32, 7),
    now: () => 2_000,
    randomBytes: () => Buffer.alloc(32, 9),
    verifier: {
      async listPullRequests() {
        baselineRequests += 1;
        return [];
      },
      async exchangeManifest() {
        throw new Error("reactivation must not exchange a GitHub App Manifest");
      },
      async verifyInstallation(credential) {
        assert.deepEqual(credential, {
          app_id: 47,
          app_slug: "quality-bar-personal",
          client_id: null,
          owner: { id: 91, login: "operator", type: "User" },
          pem: "replacement-private-key",
        });
        return verifiedInstallation;
      },
      async verifyRepositories() {
        throw new Error("repository selection is not exercised");
      },
    },
  });
  const retired = lifecycleService.retire({ lifecycle: "retired" });
  if (!retired) {
    throw new Error("retired_connection_missing");
  }
  assert.equal(retired.lifecycle, "retired");
  assert.equal(
    lifecycleCore.get(
      "SELECT count(*) AS count FROM github_connection_credentials",
    )?.count,
    0,
  );
  const restored = await lifecycleService.reactivate({
    pem: "replacement-private-key",
  });
  if (!restored) {
    throw new Error("reactivated_connection_missing");
  }
  assert.equal(restored.id, completed.id);
  assert.equal(restored.lifecycle, "enabled");
  assert.equal(restored.verification_history.length, 2);
  assert.equal(restored.verification_history[0]?.trigger, "onboarding");
  assert.equal(restored.verification_history.at(-1)?.trigger, "enablement");
  assert.equal(baselineRequests, 0);
  assert.deepEqual(
    lifecycleCore.get(
      `SELECT baseline_status, last_success_at, snapshot
         FROM github_repository_polls WHERE forge_repository_id = 101`,
    ),
    {
      baseline_status: "complete",
      last_success_at: 1_000,
      snapshot: "[]",
    },
  );
  const replacementCredential = lifecycleCore.get(
    "SELECT encrypted_credential FROM github_connection_credentials",
  ) as { encrypted_credential: string };
  assert.doesNotMatch(
    replacementCredential.encrypted_credential,
    /replacement-private-key/,
  );
  const restartedLifecycleService = createGitHubConnectionService(
    lifecycleCore,
    {
      storageReserve: availableStorageReserve,
      externalOrigin: "https://quality-bar.example",
      masterKey: Buffer.alloc(32, 7),
    },
  );
  assert.equal(restartedLifecycleService.read()?.id, completed.id);
  restartedLifecycleService.destroy();
  lifecycleService.retire({ lifecycle: "retired" });
  const failedReactivationService = createGitHubConnectionService(
    lifecycleCore,
    {
      storageReserve: availableStorageReserve,
      externalOrigin: "https://quality-bar.example",
      masterKey: Buffer.alloc(32, 7),
      verifier: {
        listPullRequests: async () => [],
        async exchangeManifest() {
          throw new Error(
            "reactivation must not exchange a GitHub App Manifest",
          );
        },
        async verifyInstallation() {
          throw new GitHubConnectionError(
            "github_permissions_mismatch",
            "GitHub App permissions do not match the required profile",
          );
        },
        async verifyRepositories() {
          throw new Error("repository selection is not exercised");
        },
      },
    },
  );
  await assert.rejects(
    () =>
      failedReactivationService.reactivate({ pem: "invalid-replacement-key" }),
    (error) =>
      error instanceof GitHubConnectionError &&
      error.code === "github_permissions_mismatch",
  );
  failedReactivationService.destroy();
  assert.equal(lifecycleService.read()?.lifecycle, "retired");
  assert.equal(
    lifecycleCore.get(
      "SELECT count(*) AS count FROM github_connection_credentials",
    )?.count,
    0,
  );
  assert.equal(
    lifecycleCore.get(
      "SELECT count(*) AS count FROM github_connection_verifications",
    )?.count,
    2,
  );
  lifecycleCore.run("DELETE FROM github_repository_polls");
  lifecycleCore.run("DELETE FROM github_repositories");
  lifecycleCore.run("DELETE FROM repositories");
  lifecycleCore.run(
    "INSERT INTO quality_bar_metadata (key, value) VALUES (?, ?)",
    "github_poll_gate:connection-1",
    '{"code":"github_api_transient_failure"}',
  );
  lifecycleService.remove();
  assert.equal(
    lifecycleCore.get("SELECT count(*) AS count FROM github_connections")
      ?.count,
    0,
  );
  assert.equal(
    lifecycleCore.get(
      "SELECT count(*) AS count FROM quality_bar_metadata WHERE key LIKE 'github_poll_gate:%'",
    )?.count,
    0,
  );
  assert.equal(
    lifecycleCore.get(
      "SELECT count(*) AS count FROM github_connection_verifications",
    )?.count,
    0,
  );
  lifecycleService.destroy();
  lifecycleCore.close();
});

test("SQLite stores no Connection, credential, or history after verification failure", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-github-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  const service = createGitHubConnectionService(core, {
    storageReserve: availableStorageReserve,
    externalOrigin: "https://quality-bar.example",
    masterKey: Buffer.alloc(32, 7),
    randomBytes: () => Buffer.alloc(32, 6),
    verifier: {
      listPullRequests: async () => [],
      async exchangeManifest() {
        return convertedApp;
      },
      async verifyInstallation() {
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
  const started = service.start();
  await service.completeManifest({ code: "code", state: started.state });
  await assert.rejects(
    () =>
      service.completeInstallation({
        installationId: "73",
        state: started.state,
      }),
    (error) =>
      error instanceof GitHubConnectionError &&
      error.code === "github_permissions_mismatch",
  );
  for (const table of [
    "github_connections",
    "github_connection_credentials",
    "github_connection_verifications",
  ]) {
    assert.equal(core.get(`SELECT count(*) AS count FROM ${table}`)?.count, 0);
  }
  service.destroy();
  core.close();
});
