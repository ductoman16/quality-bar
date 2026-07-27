import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createGitHubConnectionService } from "../src/github-connection.js";
import { GitHubConnectionError } from "../src/github-connection-error.js";
import { openDurableCore } from "../src/durable-core.js";
import { createRepositoryService } from "../src/repository.js";
import {
  fail as failRepository,
  RepositoryError,
} from "../src/repository-validation.js";

const capabilities = /** @type {any} */ ({
  aggregate_feedback: "verified",
  branch_access: "verified",
  commit_status: "verified",
  enumeration: "verified",
  inline_feedback: "verified",
  private_git_read: "verified",
  pull_request_access: "verified",
});
const availableRepositories = [
  {
    api_url: "https://api.github.com/repos/operator/alpha",
    clone_url: "https://github.com/operator/alpha.git",
    full_name: "operator/alpha",
    html_url: "https://github.com/operator/alpha",
    id: 101,
    private: true,
  },
  {
    api_url: "https://api.github.com/repos/operator/beta",
    clone_url: "https://github.com/operator/beta.git",
    full_name: "operator/beta",
    html_url: "https://github.com/operator/beta",
    id: 202,
    private: false,
  },
];

test("SQLite registers a verified GitHub Repository set atomically by Connection and stable Forge identity", async (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-github-repositories-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  let failSelection = true;
  /** @type {GitHubConnectionError | undefined} */
  let connectionFailure;
  /** @type {any[] | undefined} */
  let verificationResult;
  let timestamp = 1_000;
  /** @type {any[]} */
  const verificationCalls = [];
  const service = createGitHubConnectionService(core, {
    createId: (() => {
      const ids = [
        "connection-1",
        "verification-1",
        "repository-failed-alpha",
        "repository-failed-beta",
        "repository-alpha",
        "repository-beta",
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
          capabilities,
          principal: { id: 91, login: "operator", type: "User" },
          repositories: availableRepositories,
        };
      },
      async verifyRepositories(credential, installationId, repositoryIds) {
        verificationCalls.push({
          credential,
          installationId,
          repositoryIds,
        });
        if (connectionFailure) {
          throw connectionFailure;
        }
        if (failSelection) {
          throw new GitHubConnectionError(
            "github_repository_git_read_failed",
            "GitHub private Repository read verification failed",
            { repositoryId: repositoryIds[0] },
          );
        }
        if (verificationResult) {
          return /** @type {any} */ (verificationResult);
        }
        return {
          affectedRepositoryIds: repositoryIds,
          capabilities,
          permissions: service.read()?.permissions,
          principal: { id: 91, login: "operator", type: "User" },
          repositories: availableRepositories.filter(({ id }) =>
            repositoryIds.includes(id),
          ),
          repositoryEvidence: availableRepositories,
        };
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
  await assert.rejects(
    () =>
      service.selectRepositories({
        repository_ids: [101, 202],
      }),
    (error) =>
      error instanceof GitHubConnectionError &&
      error.code === "github_repository_git_read_failed",
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM repositories")?.count,
    0,
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM github_repositories")?.count,
    0,
  );
  assert.equal(service.read()?.health, "healthy");
  assert.equal(service.read()?.verified_at, 1_100);
  failSelection = false;
  connectionFailure = new GitHubConnectionError(
    "github_permissions_mismatch",
    "GitHub App permissions do not match the required profile",
  );
  timestamp = 1_500;
  await assert.rejects(
    () => service.selectRepositories({ repository_ids: [101] }),
    (error) =>
      error instanceof GitHubConnectionError &&
      error.code === "github_permissions_mismatch",
  );
  assert.equal(service.read()?.health, "error");
  assert.deepEqual(service.read()?.health_error, {
    code: "github_permissions_mismatch",
    message: "GitHub App permissions do not match the required profile",
  });
  assert.equal(service.read()?.verified_at, 1_500);
  connectionFailure = undefined;
  timestamp = 2_000;
  for (const invalidResult of [
    [availableRepositories[0], availableRepositories[0]],
    [
      availableRepositories[0],
      {
        ...availableRepositories[1],
        clone_url: "not-a-canonical-github-url",
      },
    ],
  ]) {
    verificationResult = invalidResult;
    await assert.rejects(
      () => service.selectRepositories({ repository_ids: [101, 202] }),
      (error) =>
        error instanceof GitHubConnectionError &&
        error.code === "github_repository_verification_invalid",
    );
    assert.equal(
      core.get("SELECT count(*) AS count FROM repositories")?.count,
      0,
    );
    assert.equal(
      core.get("SELECT count(*) AS count FROM github_repositories")?.count,
      0,
    );
  }
  verificationResult = undefined;
  core.run(
    `INSERT INTO repositories (
       id, normalized_url, created_at, verified_at
     ) VALUES (?, ?, ?, ?)`,
    "conflicting-generic-repository",
    "https://github.com/operator/beta.git",
    1_500,
    1_500,
  );
  await assert.rejects(
    () => service.selectRepositories({ repository_ids: [101, 202] }),
    (error) =>
      error instanceof GitHubConnectionError &&
      error.code === "github_repository_identity_conflict",
  );
  assert.equal(service.read()?.health, "healthy");
  assert.equal(service.read()?.health_error, null);
  assert.equal(service.read()?.verified_at, 2_000);
  assert.equal(
    core.get("SELECT count(*) AS count FROM repositories")?.count,
    1,
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM github_repositories")?.count,
    0,
  );
  core.run(
    "DELETE FROM repositories WHERE id = ?",
    "conflicting-generic-repository",
  );
  const selected = await service.selectRepositories({
    repository_ids: [101, 202],
  });
  assert.deepEqual(selected, [
    {
      api_url: "https://api.github.com/repos/operator/alpha",
      assignment_count: 0,
      credential_type: "forge_connection",
      forge_connection_id: "connection-1",
      forge_repository_id: 101,
      health: "healthy",
      health_error: null,
      id: "repository-alpha",
      lifecycle: "enabled",
      name: "operator/alpha",
      provider: "github",
      url: "https://github.com/operator/alpha.git",
      verified_at: 2_000,
      web_url: "https://github.com/operator/alpha",
    },
    {
      api_url: "https://api.github.com/repos/operator/beta",
      assignment_count: 0,
      credential_type: "forge_connection",
      forge_connection_id: "connection-1",
      forge_repository_id: 202,
      health: "healthy",
      health_error: null,
      id: "repository-beta",
      lifecycle: "enabled",
      name: "operator/beta",
      provider: "github",
      url: "https://github.com/operator/beta.git",
      verified_at: 2_000,
      web_url: "https://github.com/operator/beta",
    },
  ]);
  assert.equal(
    core.get("SELECT count(*) AS count FROM repositories")?.count,
    2,
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM github_repositories")?.count,
    2,
  );
  assert.equal(service.read()?.health, "healthy");
  assert.equal(service.read()?.health_error, null);
  assert.equal(service.read()?.verified_at, 2_000);
  assert.equal(verificationCalls.length, 6);
  assert.doesNotMatch(
    JSON.stringify(
      core.all(
        `SELECT repositories.*, github_repositories.*
         FROM repositories
         JOIN github_repositories
           ON github_repositories.repository_id = repositories.id`,
      ),
    ),
    /private-key-value|Iv1\.client/,
  );
  core.run(
    "UPDATE repositories SET lifecycle = 'disabled' WHERE id = ?",
    "repository-alpha",
  );
  availableRepositories[0] = {
    ...availableRepositories[0],
    clone_url: "https://github.com/operator/alpha-renamed.git",
    full_name: "operator/alpha-renamed",
    html_url: "https://github.com/operator/alpha-renamed",
    api_url: "https://api.github.com/repos/operator/alpha-renamed",
  };
  availableRepositories.pop();
  timestamp = 3_000;
  assert.deepEqual(
    await service.selectRepositories({ repository_ids: [101] }),
    [
      {
        api_url: "https://api.github.com/repos/operator/alpha-renamed",
        assignment_count: 0,
        credential_type: "forge_connection",
        forge_connection_id: "connection-1",
        forge_repository_id: 101,
        health: "healthy",
        health_error: null,
        id: "repository-alpha",
        lifecycle: "disabled",
        name: "operator/alpha-renamed",
        provider: "github",
        url: "https://github.com/operator/alpha-renamed.git",
        verified_at: 3_000,
        web_url: "https://github.com/operator/alpha-renamed",
      },
    ],
  );
  assert.equal(service.read()?.repository_count, 1);
  const latestVerification = service.read()?.verification_history.at(-1);
  assert.deepEqual(latestVerification?.repositories, availableRepositories);
  const repositoryInventory = createRepositoryService(core, {
    masterKey: Buffer.alloc(32, 7),
    now: () => timestamp,
    async verifyForgeRepository(forgeRepositoryId) {
      try {
        await service.selectRepositories(
          {
            repository_ids: [forgeRepositoryId],
          },
          "enablement",
        );
      } catch (error) {
        if (
          error instanceof GitHubConnectionError &&
          [
            "github_repository_git_read_failed",
            "github_repository_api_access_failed",
            "github_repository_selection_unavailable",
          ].includes(error.code)
        ) {
          failRepository(error.code, error.message, error);
        }
        if (error instanceof GitHubConnectionError) {
          throw new GitHubConnectionError(error.code, error.message, {
            cause: error,
          });
        }
        throw new TypeError("Forge Repository verification failed", {
          cause: error,
        });
      }
    },
  });
  assert.deepEqual(repositoryInventory.list()[0], {
    api_url: "https://api.github.com/repos/operator/alpha-renamed",
    assignment_count: 0,
    credential_type: "forge_connection",
    forge_connection_id: "connection-1",
    forge_repository_id: 101,
    health: "healthy",
    health_error: null,
    id: "repository-alpha",
    lifecycle: "disabled",
    name: "operator/alpha-renamed",
    provider: "github",
    url: "https://github.com/operator/alpha-renamed.git",
    verified_at: 3_000,
    web_url: "https://github.com/operator/alpha-renamed",
  });
  timestamp = 4_000;
  const enabled = await repositoryInventory.setLifecycle("repository-alpha", {
    lifecycle: "enabled",
  });
  assert.equal(enabled.lifecycle, "enabled");
  if (!("verified_at" in enabled)) {
    throw new Error("GitHub Repository verification timestamp is missing");
  }
  assert.equal(enabled.verified_at, 4_000);
  assert.equal(verificationCalls.at(-1).repositoryIds[0], 101);
  await repositoryInventory.setLifecycle("repository-alpha", {
    lifecycle: "disabled",
  });
  failSelection = true;
  await assert.rejects(
    () =>
      repositoryInventory.setLifecycle("repository-alpha", {
        lifecycle: "enabled",
      }),
    (error) =>
      error instanceof RepositoryError &&
      error.code === "github_repository_git_read_failed",
  );
  const failedEnablement = repositoryInventory.list()[0];
  assert.equal(failedEnablement.lifecycle, "disabled");
  assert.equal(failedEnablement.health, "error");
  assert.deepEqual(failedEnablement.health_error, {
    code: "github_repository_git_read_failed",
    message: "GitHub private Repository read verification failed",
  });
  repositoryInventory.destroy();
  service.destroy();
  core.close();
});
