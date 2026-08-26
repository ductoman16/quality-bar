import assert from "node:assert/strict";
import { test } from "node:test";

import { GitHubConnectionError } from "../src/github/github-connection-error.ts";
import { prepareGitHubRepositoryEnablement } from "../src/repository/repository-provider-verification.ts";
import {
  assertRepositoryAcceptsNewWork,
  normalizeRepositoryLifecycleChange,
  RepositoryError,
} from "../src/repository/repository-validation.ts";

test("Repository lifecycle changes accept the operator-owned enabled, disabled, and retired transitions", () => {
  assert.deepEqual(
    normalizeRepositoryLifecycleChange({ lifecycle: "enabled" }),
    {
      lifecycle: "enabled",
    },
  );
  assert.deepEqual(
    normalizeRepositoryLifecycleChange({ lifecycle: "disabled" }),
    { lifecycle: "disabled" },
  );
  assert.deepEqual(
    normalizeRepositoryLifecycleChange({ lifecycle: "retired" }),
    { lifecycle: "retired" },
  );

  for (const [request, code] of [
    [{}, "repository_lifecycle_required"],
    [{ lifecycle: "deleted" }, "repository_lifecycle_invalid"],
    [
      { lifecycle: "disabled", unexpected: true },
      "repository_lifecycle_request_invalid",
    ],
  ]) {
    assert.throws(
      () => normalizeRepositoryLifecycleChange(request),
      (error) => error instanceof RepositoryError && error.code === code,
    );
  }
});

test("new work distinguishes operator lifecycle from the exact observed-health failure", () => {
  assert.doesNotThrow(() =>
    assertRepositoryAcceptsNewWork({
      health: "healthy",
      healthError: null,
      lifecycle: "enabled",
    }),
  );

  assert.throws(
    () =>
      assertRepositoryAcceptsNewWork({
        health: "healthy",
        healthError: null,
        lifecycle: "disabled",
      }),
    (error) =>
      error instanceof RepositoryError &&
      error.code === "repository_disabled" &&
      error.message === "Repository is disabled",
  );
  assert.throws(
    () =>
      assertRepositoryAcceptsNewWork({
        health: "healthy",
        healthError: null,
        lifecycle: "retired",
      }),
    (error) =>
      error instanceof RepositoryError &&
      error.code === "repository_retired" &&
      error.message === "Repository is retired",
  );
  assert.throws(
    () =>
      assertRepositoryAcceptsNewWork({
        health: "error",
        healthError: {
          code: "repository_git_read_failed",
          message: "Repository Git read verification failed",
        },
        lifecycle: "enabled",
      }),
    (error) =>
      error instanceof RepositoryError &&
      error.code === "repository_git_read_failed" &&
      error.message === "Repository Git read verification failed",
  );
});

test("GitHub enablement attributes only the target Repository verification failure", async () => {
  const commit = () => {};
  const connections = {
    async selectRepositories() {
      throw new GitHubConnectionError(
        "github_private_git_read_failed",
        "GitHub private Repository read verification failed",
        { commit, repositoryId: 202 },
      );
    },
  };
  await assert.rejects(
    prepareGitHubRepositoryEnablement(connections, 101),
    (error) =>
      error instanceof GitHubConnectionError &&
      !(error instanceof RepositoryError) &&
      error.repositoryId === undefined &&
      error.commit === commit,
  );

  connections.selectRepositories = async () => {
    throw new GitHubConnectionError(
      "github_private_git_read_failed",
      "GitHub private Repository read verification failed",
      { commit, repositoryId: 101 },
    );
  };
  await assert.rejects(
    prepareGitHubRepositoryEnablement(connections, 101),
    (error) =>
      error instanceof RepositoryError &&
      error.code === "github_private_git_read_failed",
  );
});
