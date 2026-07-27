import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createGitHubConnectionService } from "../src/github-connection.js";
import { GitHubConnectionError } from "../src/github-connection-error.js";
import { openDurableCore } from "../src/durable-core.js";

const repository = {
  api_url: "https://api.github.com/repos/operator/private",
  clone_url: "https://github.com/operator/private.git",
  full_name: "operator/private",
  html_url: "https://github.com/operator/private",
  id: 101,
  private: true,
};
const publicRepository = {
  api_url: "https://api.github.com/repos/operator/public",
  clone_url: "https://github.com/operator/public.git",
  full_name: "operator/public",
  html_url: "https://github.com/operator/public",
  id: 202,
  private: false,
};

test("SQLite records immutable scoped Connection verification without treating transient outages as health facts", async (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-github-verifications-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  let timestamp = 1_000;
  /** @type {GitHubConnectionError | undefined} */
  let failure;
  const service = createGitHubConnectionService(core, {
    createId: (() => {
      const ids = [
        "connection-1",
        "onboarding-1",
        "repository-1",
        "repository-2",
      ];
      return () => ids.shift();
    })(),
    externalOrigin: "https://quality-bar.example",
    masterKey: Buffer.alloc(32, 7),
    now: () => timestamp,
    randomBytes: () => Buffer.alloc(32, 5),
    verifier: {
      async exchangeManifest() {
        return {
          app_id: 47,
          app_slug: "quality-bar-personal",
          client_id: "Iv1.client",
          owner: { id: 91, login: "operator", type: "User" },
          pem: "private-key-value",
        };
      },
      async verifyInstallation() {
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
          repositories: [repository, publicRepository],
        };
      },
      async verifyRepositories(_credential, _installationId, repositoryIds) {
        void _credential;
        void _installationId;
        if (failure) {
          throw failure;
        }
        return [repository, publicRepository].filter(({ id }) =>
          repositoryIds.includes(id),
        );
      },
    },
  });
  const started = service.start();
  await service.completeManifest({ code: "code", state: started.state });
  await service.completeInstallation({
    installationId: "73",
    state: started.state,
  });

  timestamp = 1_100;
  failure = new GitHubConnectionError(
    "github_private_git_read_failed",
    "GitHub private Repository read verification failed",
    { repositoryId: 101 },
  );
  await assert.rejects(
    () => service.selectRepositories({ repository_ids: [101] }),
    (error) =>
      error instanceof GitHubConnectionError &&
      error.code === "github_private_git_read_failed",
  );
  assert.equal(service.read()?.health, "healthy");
  assert.equal(service.read()?.verified_at, 1_100);

  const historyCount = service.read()?.verification_history.length;
  timestamp = 1_200;
  failure = new GitHubConnectionError(
    "github_api_transient_failure",
    "GitHub API request temporarily failed with HTTP 503",
  );
  await assert.rejects(
    () => service.selectRepositories({ repository_ids: [101] }),
    (error) =>
      error instanceof GitHubConnectionError &&
      error.code === "github_api_transient_failure",
  );
  assert.equal(service.read()?.verification_history.length, historyCount);
  assert.equal(service.read()?.verified_at, 1_100);

  timestamp = 1_300;
  failure = new GitHubConnectionError(
    "github_permissions_mismatch",
    "GitHub App permissions do not match the required profile",
  );
  await assert.rejects(
    () => service.selectRepositories({ repository_ids: [101] }),
    (error) =>
      error instanceof GitHubConnectionError &&
      error.code === "github_permissions_mismatch",
  );
  assert.equal(service.read()?.health, "error");

  timestamp = 1_400;
  failure = undefined;
  await service.selectRepositories({ repository_ids: [101, 202] });
  assert.equal(service.read()?.health, "healthy");
  assert.equal(service.read()?.health_error, null);

  timestamp = 1_500;
  failure = new GitHubConnectionError(
    "github_private_git_read_failed",
    "GitHub private Repository read verification failed",
    { repositoryId: 101 },
  );
  await assert.rejects(
    () => service.selectRepositories({ repository_ids: [101] }, "enablement"),
    (error) =>
      error instanceof GitHubConnectionError &&
      error.code === "github_private_git_read_failed",
  );
  assert.deepEqual(
    core.all("SELECT id, health FROM repositories ORDER BY id"),
    [
      { health: "error", id: "repository-1" },
      { health: "healthy", id: "repository-2" },
    ],
  );

  const history = service.read()?.verification_history ?? [];
  assert.deepEqual(
    history.map(({ error, outcome, trigger }) => ({
      error: error?.code ?? null,
      outcome,
      trigger,
    })),
    [
      { error: null, outcome: "success", trigger: "onboarding" },
      {
        error: "github_private_git_read_failed",
        outcome: "error",
        trigger: "repository_selection",
      },
      {
        error: "github_permissions_mismatch",
        outcome: "error",
        trigger: "repository_selection",
      },
      {
        error: null,
        outcome: "success",
        trigger: "repository_selection",
      },
      {
        error: "github_private_git_read_failed",
        outcome: "error",
        trigger: "enablement",
      },
    ],
  );
  assert.throws(
    () =>
      core.run(
        "UPDATE github_connection_verifications SET outcome = 'success'",
      ),
    /github_connection_verification_immutable/,
  );
  assert.throws(
    () => core.run("DELETE FROM github_connection_verifications"),
    /github_connection_verification_immutable/,
  );

  service.destroy();
  core.close();
});
