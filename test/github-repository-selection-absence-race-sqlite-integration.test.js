import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { GitHubConnectionError } from "../src/github/github-connection-error.js";
import { openDurableCore } from "../src/durable/durable-core.js";
import {
  availableRepositories,
  capabilities,
} from "./github-repository-selection-fixtures.js";
import { createAvailableGitHubConnectionService } from "./storage-reserve-support.js";

test("ordinary GitHub failure rejects a Repository registered after the verification snapshot", async (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-github-absent-race-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  let registerDuringVerification = false;
  const service = createAvailableGitHubConnectionService(core, {
    createId: (() => {
      const ids = ["connection-1", "verification-1"];
      return () => ids.shift();
    })(),
    externalOrigin: "https://quality-bar.example",
    masterKey: Buffer.alloc(32, 26),
    now: () => 1_000,
    randomBytes: () => Buffer.alloc(32, 6),
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
      async verifyRepositories(...parameters) {
        const repositoryIds = parameters[2];
        if (registerDuringVerification) {
          core.run(
            `INSERT INTO repositories (
               id, normalized_url, created_at, verified_at
             ) VALUES (
               'concurrent-repository',
               'https://github.com/operator/alpha.git',
               1000,
               1000
             )`,
          );
          core.run(
            `INSERT INTO github_repositories (
               repository_id, connection_id, forge_repository_id,
               name, api_url, web_url, verification_id
             ) VALUES (
               'concurrent-repository',
               'connection-1',
               101,
               'operator/alpha',
               'https://api.github.com/repos/operator/alpha',
               'https://github.com/operator/alpha',
               'verification-1'
             )`,
          );
          throw new GitHubConnectionError(
            "github_repository_git_read_failed",
            "GitHub Repository Git read failed",
            {
              affectedRepositoryIds: repositoryIds,
              repositoryId: 101,
            },
          );
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
  const beforeCount = core.get(
    "SELECT count(*) AS count FROM github_connection_verifications",
  )?.count;

  registerDuringVerification = true;
  await assert.rejects(
    service.selectRepositories({
      repository_ids: [101],
      request_id: "00000000-0000-4000-8000-000000000004",
    }),
    (error) =>
      error instanceof GitHubConnectionError &&
      error.code === "github_repository_enablement_conflict",
  );
  assert.deepEqual(
    core.get(
      `SELECT repositories.lifecycle, repositories.health,
              github_repositories.verification_id
       FROM repositories
       JOIN github_repositories
         ON github_repositories.repository_id = repositories.id
       WHERE repositories.id = 'concurrent-repository'`,
    ),
    {
      health: "healthy",
      lifecycle: "enabled",
      verification_id: "verification-1",
    },
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM github_connection_verifications")
      ?.count,
    beforeCount,
  );
  service.destroy();
  core.close();
});
