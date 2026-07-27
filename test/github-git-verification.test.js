import assert from "node:assert/strict";
import { test } from "node:test";

import { GitHubConnectionError } from "../src/github-connection-error.js";
import { verifyGitHubRepositoryRead } from "../src/github-git-verification.js";
import { RepositoryError } from "../src/repository-validation.js";

test("GitHub Git verification separates definitive access loss from operational unavailability", async () => {
  const repository = {
    clone_url: "https://github.com/operator/private.git",
    id: 101,
  };
  const affectedRepositoryIds = [101, 202];
  for (const [sourceCode, expectedCode] of [
    ["repository_git_read_failed", "github_repository_git_read_failed"],
    [
      "repository_git_verification_unavailable",
      "github_git_verification_failed",
    ],
  ]) {
    await assert.rejects(
      () =>
        verifyGitHubRepositoryRead(
          async () => {
            return Promise.reject(
              new RepositoryError(sourceCode, "exact Git failure"),
            );
          },
          repository,
          "installation-token",
          affectedRepositoryIds,
        ),
      (error) =>
        error instanceof GitHubConnectionError &&
        error.code === expectedCode &&
        error.repositoryId === 101 &&
        error.affectedRepositoryIds === affectedRepositoryIds,
    );
  }
});
