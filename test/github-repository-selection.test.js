import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeGitHubRepositorySelection } from "../src/github-repository-selection.js";
import { createGitHubRepositorySelectionCommit } from "../src/github-repository-selection-commit.js";
import { GitHubConnectionError } from "../src/github-connection-error.js";

test("GitHub Repository selection requires one exact nonempty set of stable Forge Repository IDs", () => {
  assert.deepEqual(
    normalizeGitHubRepositorySelection({ repository_ids: [101, 202] }, false),
    { repositoryIds: [101, 202], requestId: undefined },
  );
  assert.deepEqual(
    normalizeGitHubRepositorySelection({
      repository_ids: [101],
      request_id: "00000000-0000-4000-8000-000000000001",
    }),
    {
      repositoryIds: [101],
      requestId: "00000000-0000-4000-8000-000000000001",
    },
  );

  for (const request of [
    null,
    {},
    { repository_ids: [] },
    { repository_ids: [101, 101] },
    { repository_ids: [0] },
    { repository_ids: ["101"] },
    { repository_ids: [101] },
    { repository_ids: [101], request_id: "not-a-uuid" },
    { repository_ids: [101], unexpected: true },
  ]) {
    assert.throws(() => normalizeGitHubRepositorySelection(request), {
      code: "github_repository_selection_invalid",
      message:
        "GitHub Repository selection must contain unique stable Repository IDs",
    });
  }
});

test("a deferred GitHub Repository commit translates exact identity conflicts", () => {
  const commit = createGitHubRepositorySelectionCommit({
    affectedRepositoryIds: [101],
    connection: {
      encrypted_credential: "encrypted",
      id: "connection-1",
    },
    connectionId: "connection-1",
    deferCommit: true,
    existing: new Map(),
    records: [],
    removedVerifications: [],
    verification: {},
    verified: {
      commit() {
        throw new Error(
          "UNIQUE constraint failed: repositories.normalized_url",
        );
      },
    },
    verifier: {
      commitPollingBaseline() {},
      commitPollingFailure() {},
    },
  });

  assert.throws(
    () =>
      commit({
        get() {
          return {
            encrypted_credential: "encrypted",
            lifecycle: "enabled",
          };
        },
      }),
    (error) =>
      error instanceof GitHubConnectionError &&
      error.code === "github_repository_identity_conflict" &&
      error.message === "GitHub Repository identity is already registered",
  );
});
