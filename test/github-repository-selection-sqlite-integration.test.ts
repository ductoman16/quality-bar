import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createAvailableGitHubConnectionService as createGitHubConnectionService } from "./storage-reserve-support.ts";
import { GitHubConnectionError } from "../src/github/github-connection-error.ts";
import { openDurableCore } from "../src/durable/durable-core.ts";
import { createRepositoryService } from "../src/repository/repository.ts";
import {
  availableRepositories,
  assertGitHubLifecycleVerification,
  assertCorrelatedSelection,
  assertRemovedVerificationState,
  capabilities,
  createSelectionRequests,
  markPrivateRepositoryUnhealthy,
  readPrivateRepositoryState,
  readRemovedRepositoryState,
  removedRepositoryState,
  renamePrivateRepository,
} from "./github-repository-selection-fixtures.ts";
import { prepareStaleGitHubRepositoryEnablement } from "./github-repository-selection-race-support.ts";

test("SQLite registers a verified GitHub Repository set atomically by Connection and stable Forge identity", async (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-github-repositories-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  const selection = createSelectionRequests();
  let failSelection = true;
  let retireOnConnectionFailure = false;
  let retireOnSelectionFailure = false;
  let retireSiblingAfterPreparation = false;
  let staleEnablement = false;
  let connectionFailure: GitHubConnectionError | undefined;
  let verificationResult: any;
  let timestamp = 1_000;
  const verificationCalls: any[] = [];
  const service = createGitHubConnectionService(core, {
    createId: (() => {
      const ids = [
        "connection-1",
        "verification-1",
        "repository-failed-alpha",
        "repository-failed-beta",
        "repository-alpha",
        "repository-beta",
        "connection-reactivation-verification",
        "connection-reactivation-verification-2",
        "connection-reactivation-verification-3",
        "connection-reactivation-verification-4",
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
      listPullRequests: async () => [],
      async verifyRepositories(credential, installationId, repositoryIds) {
        verificationCalls.push({
          credential,
          installationId,
          repositoryIds,
        });
        if (connectionFailure) {
          if (retireOnConnectionFailure) {
            service.retire({ lifecycle: "retired" });
          }
          throw connectionFailure;
        }
        if (failSelection) {
          if (retireOnSelectionFailure) {
            service.retire({ lifecycle: "retired" });
          }
          throw new GitHubConnectionError(
            "github_repository_git_read_failed",
            "GitHub private Repository read verification failed",
            { repositoryId: repositoryIds[0] },
          );
        }
        if (verificationResult) {
          return verificationResult as any;
        }
        const affectedRepositoryIds = repositoryIds.includes(101)
          ? repositoryIds
          : [...repositoryIds, 101];
        return {
          affectedRepositoryIds,
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
    () => service.selectRepositories(selection([101, 202])),
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
    () => service.selectRepositories(selection([101])),
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
    [
      { ...availableRepositories[0], private: undefined },
      availableRepositories[1],
    ],
  ]) {
    verificationResult = {
      affectedRepositoryIds: [101, 202],
      capabilities,
      permissions: service.read()?.permissions,
      principal: { id: 91, login: "operator", type: "User" },
      repositories: invalidResult,
      repositoryEvidence: invalidResult,
    };
    await assert.rejects(
      () => service.selectRepositories(selection([101, 202])),
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
    () => service.selectRepositories(selection([101, 202])),
    (error) =>
      error instanceof GitHubConnectionError &&
      error.code === "github_repository_identity_conflict",
  );
  assert.equal(service.read()?.health, "error");
  assert.equal(service.read()?.verified_at, 1_500);
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
  const selected = await service.selectRepositories(selection([101, 202]));
  assert.deepEqual(selected, [
    {
      api_url: "https://api.github.com/repos/operator/alpha",
      assignment_count: 0,
      credential_type: "forge_connection",
      deletion_eligible: true,
      forge_connection_id: "connection-1",
      forge_repository_id: 101,
      health: "healthy",
      health_error: null,
      id: "repository-alpha",
      lifecycle: "enabled",
      name: "operator/alpha",
      provider: "github",
      url: "https://github.com/operator/alpha.git",
      verification_id: "00000000-0000-4000-8000-000000000007",
      verified_at: 2_000,
      web_url: "https://github.com/operator/alpha",
    },
    {
      api_url: "https://api.github.com/repos/operator/beta",
      assignment_count: 0,
      credential_type: "forge_connection",
      deletion_eligible: true,
      forge_connection_id: "connection-1",
      forge_repository_id: 202,
      health: "healthy",
      health_error: null,
      id: "repository-beta",
      lifecycle: "enabled",
      name: "operator/beta",
      provider: "github",
      url: "https://github.com/operator/beta.git",
      verification_id: "00000000-0000-4000-8000-000000000007",
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
  assert.equal(verificationCalls.length, 7);
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
  markPrivateRepositoryUnhealthy(core);
  renamePrivateRepository();
  timestamp = 2_500;
  await assertCorrelatedSelection(service, selection([202]));
  assert.deepEqual(readPrivateRepositoryState(core), {
    health: "healthy",
    name: "operator/alpha-renamed",
    normalized_url: "https://github.com/operator/alpha-renamed.git",
    verification_id: "00000000-0000-4000-8000-000000000008",
    verified_at: 2_500,
  });
  core.run(
    "UPDATE repositories SET lifecycle = 'disabled' WHERE id = ?",
    "repository-alpha",
  );
  availableRepositories.pop();
  timestamp = 3_000;
  assert.deepEqual(await service.selectRepositories(selection([101])), [
    {
      api_url: "https://api.github.com/repos/operator/alpha-renamed",
      assignment_count: 0,
      credential_type: "forge_connection",
      deletion_eligible: true,
      forge_connection_id: "connection-1",
      forge_repository_id: 101,
      health: "healthy",
      health_error: null,
      id: "repository-alpha",
      lifecycle: "disabled",
      name: "operator/alpha-renamed",
      provider: "github",
      url: "https://github.com/operator/alpha-renamed.git",
      verification_id: "00000000-0000-4000-8000-000000000009",
      verified_at: 3_000,
      web_url: "https://github.com/operator/alpha-renamed",
    },
  ]);
  assert.equal(service.read()?.repository_count, 1);
  assertRemovedVerificationState(service.read(), availableRepositories);
  assert.deepEqual(readRemovedRepositoryState(core), removedRepositoryState);
  const repositoryInventory = createRepositoryService(core, {
    masterKey: Buffer.alloc(32, 7),
    now: () => timestamp,
    verifyForgeRepository: (forgeRepositoryId) =>
      prepareStaleGitHubRepositoryEnablement(
        core,
        service,
        forgeRepositoryId,
        staleEnablement,
        retireSiblingAfterPreparation,
      ),
  });
  assert.deepEqual(repositoryInventory.list()[0], {
    api_url: "https://api.github.com/repos/operator/alpha-renamed",
    assignment_count: 0,
    credential_type: "forge_connection",
    deletion_eligible: true,
    forge_connection_id: "connection-1",
    forge_repository_id: 101,
    health: "healthy",
    health_error: null,
    id: "repository-alpha",
    lifecycle: "disabled",
    name: "operator/alpha-renamed",
    provider: "github",
    url: "https://github.com/operator/alpha-renamed.git",
    verification_id: "00000000-0000-4000-8000-000000000009",
    verified_at: 3_000,
    web_url: "https://github.com/operator/alpha-renamed",
  });
  timestamp = 4_000;
  await assertGitHubLifecycleVerification({
    core,
    repositories: repositoryInventory,
    service,
    setConnectionFailure(failure: GitHubConnectionError | undefined) {
      connectionFailure = failure;
    },
    setRetireOnConnectionFailure(retires: boolean) {
      retireOnConnectionFailure = retires;
    },
    setSelectionFailure(fails: boolean) {
      failSelection = fails;
    },
    setRetireOnSelectionFailure(retires: boolean) {
      retireOnSelectionFailure = retires;
    },
    setRetireSiblingOnVerification(retires: boolean) {
      retireSiblingAfterPreparation = retires;
    },
    setStale(stale: boolean) {
      staleEnablement = stale;
    },
    verificationCalls,
  });
  repositoryInventory.destroy();
  service.destroy();
  core.close();
});
