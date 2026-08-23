import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable/durable-core.js";
import { createForgejoConnectionService } from "../src/forgejo/forgejo-connection.js";
import {
  createForgejoPollingService,
  readForgejoPollingGeneration,
} from "../src/forgejo/forgejo-polling.js";
import { GitHubConnectionError } from "../src/github/github-connection-error.js";
import { createGitHubPollingService } from "../src/github/github-polling.js";
import { readGitHubPollingGeneration } from "../src/github/github-polling-generation.js";
import { createRepositoryService } from "../src/repository/repository.js";
import {
  forgejoVerification,
  repositoryEvidence,
} from "./forgejo-polling-sqlite-integration-support.js";
import {
  availableRepositories,
  capabilities,
} from "./github-repository-selection-fixtures.js";
import {
  availableStorageReserve,
  createAvailableGitHubConnectionService,
  forgejoAutomaticEvaluationTestDependencies,
} from "./storage-reserve-support.js";

const masterKey = Buffer.alloc(32, 29);

/** @param {import("node:test").TestContext} context @param {string} label */
function openTestCore(context, label) {
  const directory = mkdtempSync(join(tmpdir(), label));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  return openDurableCore(join(directory, "quality-bar.sqlite3"));
}

/** @param {any} core */
async function establishGitHubRepository(core) {
  const service = createAvailableGitHubConnectionService(core, {
    createId: (() => {
      const ids = ["github-connection", "github-verification", "repository"];
      return () => ids.shift();
    })(),
    externalOrigin: "https://quality-bar.example",
    masterKey,
    now: () => 1_000,
    randomBytes: () => Buffer.alloc(32, 9),
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
  await service.selectRepositories({
    repository_ids: [101],
    request_id: "00000000-0000-4000-8000-000000000029",
  });
  return service;
}

/** @param {any} core */
async function establishForgejoRepository(core) {
  const evidence = repositoryEvidence(11, "private");
  const service = createForgejoConnectionService(core, {
    ...forgejoAutomaticEvaluationTestDependencies,
    createId: (() => {
      const ids = ["forgejo-connection", "forgejo-verification", "repository"];
      return () => ids.shift();
    })(),
    masterKey,
    now: () => 1_000,
    storageReserve: availableStorageReserve,
    verifier: {
      async listPullRequests() {
        return [];
      },
      async verify() {
        return forgejoVerification([evidence]);
      },
    },
  });
  await service.connect({
    base_url: "https://forgejo.example",
    repository_ids: [11],
    token: "pat",
  });
  return service;
}

/** @param {any} core @param {"github" | "forgejo"} provider @param {"delete" | "retire"} action */
async function removeRepository(core, provider, action) {
  const repositories = createRepositoryService(core, { masterKey });
  if (action === "retire") {
    core.run(
      "UPDATE repositories SET has_been_used = 1 WHERE id = 'repository'",
    );
    await repositories.setLifecycle("repository", { lifecycle: "retired" });
  } else {
    repositories.remove("repository");
  }
  repositories.destroy();
  const retained = action === "retire" ? 1 : 0;
  assert.equal(
    core.get("SELECT count(*) AS count FROM repositories")?.count,
    retained,
  );
  assert.equal(
    core.get(`SELECT count(*) AS count FROM ${provider}_repositories`)?.count,
    retained,
  );
  assert.equal(
    core.get(`SELECT count(*) AS count FROM ${provider}_repository_polls`)
      ?.count,
    retained,
  );
}

test("GitHub removal fences in-flight polling success and failure", async (context) => {
  for (const action of ["delete", "retire"]) {
    for (const outcome of ["success", "failure"]) {
      const core = openTestCore(
        context,
        `quality-bar-github-${action}-${outcome}-`,
      );
      const connection = await establishGitHubRepository(core);
      const expectedGeneration = readGitHubPollingGeneration(
        core,
        "github-connection",
      );
      /** @type {((transaction: any) => boolean) | undefined} */
      let failureCommit;
      const polling = createGitHubPollingService(core, {
        async fetchPullRequests() {
          if (outcome === "failure") {
            throw new GitHubConnectionError(
              "github_repository_api_access_failed",
              "GitHub Repository polling failed",
              { repositoryId: 101 },
            );
          }
          return [];
        },
        now: () => 2_000,
        recordOwningFailure(transaction) {
          transaction.run(
            "UPDATE github_connections SET health = 'error' WHERE id = 'github-connection'",
          );
        },
      });
      /** @type {any} */
      let prepared;
      try {
        prepared = await polling.prepare(
          {
            connection: { id: "github-connection" },
            credential: {},
            repositories: [{ id: 101 }],
          },
          {
            onFailure(failure, commit) {
              assert.equal(failure.code, "github_repository_api_access_failed");
              failureCommit = commit;
            },
            recordFailure: false,
          },
        );
      } catch (error) {
        assert.equal(outcome, "failure");
        assert.equal(
          /** @type {GitHubConnectionError} */ (error).code,
          "github_repository_api_access_failed",
        );
      }
      await removeRepository(
        core,
        "github",
        /** @type {"delete" | "retire"} */ (action),
      );
      const committed = core.transaction((transaction) =>
        outcome === "success"
          ? polling.commitSuccess(transaction, "github-connection", prepared)
          : failureCommit?.(transaction),
      );
      assert.equal(committed, false);
      assert.equal(
        readGitHubPollingGeneration(core, "github-connection"),
        expectedGeneration + 1,
      );
      assert.equal(
        core.get("SELECT count(*) AS count FROM github_repository_polls")
          ?.count,
        action === "retire" ? 1 : 0,
      );
      assert.equal(
        core.get(
          "SELECT count(*) AS count FROM quality_bar_metadata WHERE key = 'github_poll_gate:github-connection'",
        )?.count,
        0,
      );
      assert.equal(
        core.get(
          "SELECT health FROM github_connections WHERE id = 'github-connection'",
        )?.health,
        "healthy",
      );
      connection.destroy();
      core.close();
    }
  }
});

test("Forgejo removal fences in-flight polling success and failure", async (context) => {
  for (const action of ["delete", "retire"]) {
    for (const outcome of ["success", "failure"]) {
      const core = openTestCore(
        context,
        `quality-bar-forgejo-${action}-${outcome}-`,
      );
      const connection = await establishForgejoRepository(core);
      const expectedGeneration = readForgejoPollingGeneration(
        core,
        "forgejo-connection",
      );
      const failure = Object.assign(
        new Error("Forgejo Repository polling failed"),
        {
          code: "forgejo_repository_api_access_failed",
          repositoryId: 11,
        },
      );
      const polling = createForgejoPollingService(core, {
        async fetchPullRequests() {
          if (outcome === "failure") {
            throw failure;
          }
          return [];
        },
        now: () => 2_000,
        recordOwningFailure(transaction) {
          transaction.run(
            "UPDATE forgejo_connections SET health = 'error' WHERE id = 'forgejo-connection'",
          );
        },
      });
      /** @type {any} */
      let prepared;
      try {
        prepared = await polling.prepare(
          {
            connection: { id: "forgejo-connection" },
            credential: {},
            repositories: [{ full_name: "operator/private", id: 11 }],
          },
          { recordFailure: false },
        );
      } catch (error) {
        assert.equal(error, failure);
      }
      await removeRepository(
        core,
        "forgejo",
        /** @type {"delete" | "retire"} */ (action),
      );
      const committed = core.transaction((transaction) =>
        outcome === "success"
          ? polling.commitSuccess(transaction, "forgejo-connection", prepared)
          : polling.commitFailure(
              transaction,
              "forgejo-connection",
              [11],
              failure,
              2_000,
              false,
              expectedGeneration,
            ),
      );
      assert.equal(committed, false);
      assert.equal(
        readForgejoPollingGeneration(core, "forgejo-connection"),
        expectedGeneration + 1,
      );
      assert.equal(
        core.get("SELECT count(*) AS count FROM forgejo_repository_polls")
          ?.count,
        action === "retire" ? 1 : 0,
      );
      assert.equal(
        core.get(
          "SELECT count(*) AS count FROM quality_bar_metadata WHERE key = 'forgejo_poll_gate:forgejo-connection'",
        )?.count,
        0,
      );
      assert.equal(
        core.get(
          "SELECT health FROM forgejo_connections WHERE id = 'forgejo-connection'",
        )?.health,
        "healthy",
      );
      connection.destroy();
      core.close();
    }
  }
});
