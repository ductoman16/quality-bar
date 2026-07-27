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
import { createRepositoryService } from "../src/repository.js";

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
        if (failSelection) {
          throw new GitHubConnectionError(
            "github_private_git_read_failed",
            "GitHub private Repository read verification failed",
          );
        }
        return availableRepositories.filter(({ id }) =>
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

  await assert.rejects(
    () =>
      service.selectRepositories({
        repository_ids: [101, 202],
      }),
    (error) =>
      error instanceof GitHubConnectionError &&
      error.code === "github_private_git_read_failed",
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM repositories")?.count,
    0,
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM github_repositories")?.count,
    0,
  );

  failSelection = false;
  timestamp = 2_000;
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
  assert.equal(verificationCalls.length, 3);
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
  const repositoryInventory = createRepositoryService(core, {
    masterKey: Buffer.alloc(32, 7),
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

  repositoryInventory.destroy();
  service.destroy();
  core.close();
});

test("SQLite migrates the completed GitHub Connection schema to stable Forge Repository identity", (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-github-repository-migration-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const databasePath = join(directory, "quality-bar.sqlite3");
  const prior = openDurableCore(databasePath);
  prior.run("DROP TABLE github_repositories");
  prior.run(
    "UPDATE quality_bar_metadata SET value = '13' WHERE key = 'schema_version'",
  );
  prior.run("PRAGMA user_version = 13");
  prior.close();

  const migrated = openDurableCore(databasePath);
  assert.equal(migrated.facts.schemaVersion, 14);
  assert.deepEqual(
    migrated.get(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'github_repositories'",
    ),
    { name: "github_repositories" },
  );
  migrated.close();
});
