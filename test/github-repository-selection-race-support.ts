import assert from "node:assert/strict";

import { GitHubConnectionError } from "../src/github/github-connection-error.ts";
import { fail as failRepository } from "../src/repository/repository-validation.ts";

function readGitHubVerificationCount(core: any) {
  return core.get(
    "SELECT count(*) AS count FROM github_connection_verifications",
  )?.count;
}

export async function assertGitHubSiblingRetirementRace(
  core: any,
  repositories: any,
  setConnectionFailure: (failure: GitHubConnectionError | undefined) => void,
  setRetireSibling: (retires: boolean) => void,
) {
  const verificationCount = readGitHubVerificationCount(core);
  core.run(
    "UPDATE repositories SET has_been_used = 1 WHERE id = ?",
    "repository-beta",
  );
  setConnectionFailure(
    new GitHubConnectionError(
      "github_private_git_read_failed",
      "GitHub sibling Repository read verification failed",
      { affectedRepositoryIds: [101, 202], repositoryId: 202 },
    ),
  );
  setRetireSibling(true);
  await assert.rejects(
    repositories.setLifecycle("repository-alpha", { lifecycle: "enabled" }),
    { code: "github_repository_enablement_conflict" },
  );
  assert.equal(readGitHubVerificationCount(core), verificationCount);
  assert.deepEqual(
    core.all("SELECT id, lifecycle FROM repositories ORDER BY id"),
    [
      { id: "repository-alpha", lifecycle: "retired" },
      { id: "repository-beta", lifecycle: "retired" },
    ],
  );
  setConnectionFailure(undefined);
  setRetireSibling(false);
}

async function prepareGitHubRepositoryEnablement(
  service: any,
  forgeRepositoryId: number,
) {
  try {
    const prepared = await service.selectRepositories(
      { repository_ids: [forgeRepositoryId] },
      "enablement",
      { deferCommit: true },
    );
    if (
      !prepared ||
      Array.isArray(prepared) ||
      typeof prepared.commit !== "function"
    ) {
      throw new TypeError("GitHub Repository enablement was not prepared");
    }
    return prepared;
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
        commit: typeof error.commit === "function" ? error.commit : undefined,
      });
    }
    throw new TypeError("Forge Repository verification failed", {
      cause: error,
    });
  }
}

export async function prepareStaleGitHubRepositoryEnablement(
  core: any,
  service: any,
  forgeRepositoryId: number,
  stale: boolean,
  retireSibling: boolean,
) {
  try {
    return await prepareGitHubRepositoryEnablement(service, forgeRepositoryId);
  } finally {
    if (stale) {
      core.run(
        `UPDATE repositories
         SET lifecycle_revision = lifecycle_revision + 2
         WHERE id = ?`,
        "repository-alpha",
      );
    }
    if (retireSibling) {
      core.run(
        `UPDATE repositories
         SET lifecycle = 'retired',
             lifecycle_revision = lifecycle_revision + 1
         WHERE id = ?`,
        "repository-beta",
      );
    }
  }
}
