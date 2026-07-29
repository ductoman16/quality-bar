import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { GitHubConnectionError } from "../src/github-connection-error.js";
import { createGitHubPollingService } from "../src/github-polling.js";
import {
  createAvailableGitHubPollingRunner,
  seedDueGitHubPoll,
} from "./storage-reserve-support.js";

test("a GitHub polling failure cannot hide a newer polling generation", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-github-poll-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  const polling = createGitHubPollingService(core, {
    async fetchPullRequests() {
      core.run(
        `INSERT INTO quality_bar_metadata (key, value)
         VALUES ('github_poll_generation:connection-1', '1')`,
      );
      throw new GitHubConnectionError(
        "github_repository_api_access_failed",
        "GitHub Repository polling failed",
        { repositoryId: 101 },
      );
    },
    now: () => 5_000,
    recordOwningFailure() {},
  });

  await assert.rejects(
    () =>
      polling.reconcile({
        connection: { id: "connection-1" },
        credential: {},
        repositories: [{ id: 101 }],
      }),
    (error) =>
      error instanceof GitHubConnectionError &&
      error.code === "github_polling_conflict",
  );
  assert.deepEqual(
    core.all(
      "SELECT key, value FROM quality_bar_metadata WHERE key LIKE 'github_poll_%' ORDER BY key",
    ),
    [{ key: "github_poll_generation:connection-1", value: "1" }],
  );
  core.close();
});

test("the scheduled GitHub runner surfaces a polling generation conflict", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-github-runner-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  seedDueGitHubPoll(core);
  const runner = createAvailableGitHubPollingRunner(core, {
    cipher: { decrypt: () => ({ client_id: null, pem: "private-key" }) },
    timestamp: () => 65_000,
    verifier: {
      async listPullRequests() {
        core.run(
          `INSERT INTO quality_bar_metadata (key, value)
           VALUES ('github_poll_generation:connection-1', '1')`,
        );
        return [];
      },
      async verifyRepositories() {
        throw new Error("Repository selection is not exercised");
      },
    },
  });

  await assert.rejects(runner.runDue(), {
    code: "github_polling_conflict",
  });
  assert.deepEqual(
    core.get(
      `SELECT last_success_at, next_attempt_at, snapshot
       FROM github_repository_polls`,
    ),
    { last_success_at: 5_000, next_attempt_at: 65_000, snapshot: "[]" },
  );
  runner.destroy();
  core.close();
});
