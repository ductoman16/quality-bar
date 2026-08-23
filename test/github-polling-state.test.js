import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createGitHubPollingService,
  nextGitHubAttemptAt,
  pullRequestSnapshot,
} from "../src/github/github-polling.js";
import { GitHubConnectionError } from "../src/github/github-connection-error.js";
import { createGitHubPollingRunner } from "../src/github/github-polling-runner.js";
import { readGitHubPollingFailure } from "../src/github/github-polling-read.js";
import { availableStorageReserve } from "./storage-reserve-support.js";

test("GitHub polling lower layers reject incomplete dependencies at construction", () => {
  const core = { all() {}, transaction() {} };
  assert.throws(
    () =>
      createGitHubPollingService(
        core,
        /** @type {any} */ ({ fetchPullRequests: async () => [] }),
      ),
    /GitHub polling dependencies are invalid/,
  );
  assert.throws(
    () =>
      createGitHubPollingRunner(
        core,
        /** @type {any} */ ({
          cipher: { decrypt: () => ({}) },
          storageReserve: availableStorageReserve,
          timestamp: () => 0,
          verifier: { listPullRequests: async () => [] },
        }),
      ),
    /GitHub polling runner dependencies are invalid/,
  );
});

test("an established Repository rate gate blocks a manual baseline retry", async () => {
  let requests = 0;
  const polling = createGitHubPollingService(
    {
      /** @param {string} sql */
      all(sql) {
        return sql.includes("quality_bar_metadata")
          ? []
          : [
              {
                error_code: "github_api_transient_failure",
                error_message:
                  "GitHub API request temporarily failed with HTTP 429",
                forge_repository_id: 101,
                rate_gate_until: 125_000,
              },
            ];
      },
      transaction() {
        throw new Error("rate gate must not write");
      },
    },
    {
      async fetchPullRequests() {
        requests += 1;
        return [];
      },
      now: () => 5_000,
      recordOwningFailure() {},
    },
  );
  await assert.rejects(
    () =>
      polling.baseline({
        connection: { id: "connection-1" },
        credential: {},
        repositories: [{ id: 101 }],
      }),
    (error) =>
      error instanceof GitHubConnectionError &&
      error.nextAttemptAt === 125_000 &&
      error.repositoryId === 101,
  );
  assert.equal(requests, 0);
});

test("a connection-scoped new Repository baseline failure remains visible beside established polling", () => {
  let failure = JSON.stringify({
    code: "github_api_transient_failure",
    forgeRepositoryId: null,
    hasUnrepresentedFailureOwner: true,
    message: "GitHub API request temporarily failed with HTTP 429",
    nextAttemptAt: 125_000,
    rateGateUntil: 125_000,
  });
  const core = {
    /** @param {string} sql @param {...unknown} parameters */
    all(sql, ...parameters) {
      if (sql.includes("quality_bar_metadata")) {
        return [{ value: failure }];
      }
      return parameters[1] === 202 ? [] : [{ 1: 1 }];
    },
  };
  assert.deepEqual(readGitHubPollingFailure(core, "connection-1")?.error, {
    code: "github_api_transient_failure",
    message: "GitHub API request temporarily failed with HTTP 429",
  });
  failure = JSON.stringify({
    code: "github_api_transient_failure",
    forgeRepositoryId: 101,
    hasUnrepresentedFailureOwner: false,
    message: "GitHub API request temporarily failed with HTTP 429",
    nextAttemptAt: 125_000,
    rateGateUntil: 125_000,
  });
  assert.equal(readGitHubPollingFailure(core, "connection-1"), null);
});

test("GitHub polling targets sixty seconds unless the provider gate is later", () => {
  assert.equal(nextGitHubAttemptAt(5_000, {}), 65_000);
  assert.equal(nextGitHubAttemptAt(5_000, { nextAttemptAt: 125_000 }), 125_000);
  assert.equal(nextGitHubAttemptAt(5_000, { nextAttemptAt: 4_000 }), 65_000);
  assert.equal(
    nextGitHubAttemptAt(5_000, {
      code: "github_connection_credential_undecryptable",
    }),
    null,
  );
});

test("GitHub polling accepts only a complete array snapshot", () => {
  const snapshot = [
    {
      base: { sha: "a".repeat(40) },
      draft: false,
      head: { sha: "b".repeat(40) },
      merged_at: null,
      number: 1,
      state: "open",
    },
  ];
  assert.equal(pullRequestSnapshot(snapshot), snapshot);
  assert.throws(
    () => pullRequestSnapshot({ items: snapshot }),
    (error) =>
      error instanceof GitHubConnectionError &&
      error.code === "github_poll_response_invalid",
  );
  assert.throws(
    () => pullRequestSnapshot([{ number: 1 }]),
    (error) =>
      error instanceof GitHubConnectionError &&
      error.code === "github_poll_response_invalid",
  );
});
