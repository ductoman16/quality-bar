import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  GitHubConnectionError,
  createGitHubConnectionService,
} from "../src/github-connection.js";
import { openDurableCore } from "../src/durable-core.js";

/** @type {any} */
const verifiedInstallation = {
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
      clone_url: "https://github.com/operator/private.git",
      full_name: "operator/private",
      id: 101,
      private: true,
    },
  ],
};

/** @type {any} */
const convertedApp = {
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
  assert.equal(core.facts.schemaVersion, 13);
  const service = createGitHubConnectionService(core, {
    createId: (() => {
      const ids = ["connection-1", "verification-1"];
      return () => ids.shift();
    })(),
    externalOrigin: "https://quality-bar.example",
    masterKey: Buffer.alloc(32, 7),
    now: () => 1_000,
    randomBytes: () => Buffer.alloc(32, 5),
    verifier: {
      async exchangeManifest() {
        return convertedApp;
      },
      async verifyInstallation() {
        return verifiedInstallation;
      },
    },
  });
  const started = service.start();
  await service.completeManifest({ code: "code", state: started.state });
  const completed = await service.completeInstallation({
    installationId: "73",
    state: started.state,
  });
  assert.deepEqual(service.read(), completed);

  assert.equal(
    core.get("SELECT count(*) AS count FROM github_connections")?.count,
    1,
  );
  const credential = /** @type {{encrypted_credential: string}} */ (
    core.get("SELECT encrypted_credential FROM github_connection_credentials")
  );
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
        externalOrigin: "https://quality-bar.example",
        masterKey: Buffer.alloc(32, 8),
      }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "github_connection_credential_undecryptable",
  );
  wrongKeyCore.close();
});

test("SQLite stores no Connection, credential, or history after verification failure", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-github-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  const service = createGitHubConnectionService(core, {
    externalOrigin: "https://quality-bar.example",
    masterKey: Buffer.alloc(32, 7),
    randomBytes: () => Buffer.alloc(32, 6),
    verifier: {
      async exchangeManifest() {
        return convertedApp;
      },
      async verifyInstallation() {
        throw new GitHubConnectionError(
          "github_permissions_mismatch",
          "GitHub App permissions do not match the required profile",
        );
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
