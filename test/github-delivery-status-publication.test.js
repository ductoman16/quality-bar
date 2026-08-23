import { createIoExecutionPool } from "../src/io-execution-pool.js";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable/durable-core.js";
import { createGitHubCommitStatusService } from "../src/github/github-commit-status-service.js";
import { GitHubConnectionError } from "../src/github/github-connection-error.js";
import { arrangeGitHubCommitStatus as arrange } from "./github-commit-status-publication-support.js";

test("an uncertain status response reconciles before recreate and recreates only after proven absence", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-github-status-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  arrange(core);
  let now = 0;
  /** @type {string[]} */
  const operations = [];
  let createCount = 0;
  const service = createGitHubCommitStatusService(core, {
    ioPool: createIoExecutionPool(),
    cipher: {
      decrypt: () => ({ client_id: "Iv1.client", pem: "private-key" }),
    },
    externalOrigin: "https://quality-bar.example",
    now: () => now,
    verifier: {
      async publishCommitStatus() {
        operations.push("create");
        createCount += 1;
        if (createCount === 1) {
          throw new GitHubConnectionError(
            "github_api_unavailable",
            "GitHub API request could not complete",
          );
        }
        return 903;
      },
      async reconcileCommitStatus() {
        operations.push("reconcile_absent");
        return null;
      },
    },
  });

  await service.publishWaiting();
  await service.publishWaiting();
  assert.deepEqual(operations, ["create"]);
  assert.deepEqual(
    core.get("SELECT publication_status FROM github_commit_statuses"),
    { publication_status: "waiting" },
  );
  assert.deepEqual(
    core.get(
      `SELECT attempt_count, reconciliation_required, error_code,
              next_attempt_at, external_id
       FROM github_delivery_attempts
       WHERE surface = 'commit_status'`,
    ),
    {
      attempt_count: 1,
      error_code: "github_api_unavailable",
      external_id: null,
      next_attempt_at: 60_000,
      reconciliation_required: 1,
    },
  );

  now = 60_000;
  await service.publishWaiting();
  assert.deepEqual(operations, ["create", "reconcile_absent", "create"]);
  assert.deepEqual(
    core.get(
      "SELECT publication_status, published_state FROM github_commit_statuses",
    ),
    { publication_status: "succeeded", published_state: "pending" },
  );
  assert.deepEqual(
    core.get(
      `SELECT attempt_count, reconciliation_required, error_code,
              next_attempt_at, external_id
       FROM github_delivery_attempts
       WHERE surface = 'commit_status'`,
    ),
    {
      attempt_count: 3,
      error_code: null,
      external_id: 903,
      next_attempt_at: 0,
      reconciliation_required: 0,
    },
  );
});

test("an uncertain status response accepts the reconciled external identity without another create", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-github-status-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  arrange(core);
  let now = 0;
  let creates = 0;
  const service = createGitHubCommitStatusService(core, {
    ioPool: createIoExecutionPool(),
    cipher: {
      decrypt: () => ({ client_id: "Iv1.client", pem: "private-key" }),
    },
    externalOrigin: "https://quality-bar.example",
    now: () => now,
    verifier: {
      async publishCommitStatus() {
        creates += 1;
        throw new GitHubConnectionError(
          "github_api_response_invalid",
          "GitHub commit status response is invalid",
        );
      },
      async reconcileCommitStatus() {
        return 904;
      },
    },
  });

  await service.publishWaiting();
  now = 60_000;
  await service.publishWaiting();

  assert.equal(creates, 1);
  assert.deepEqual(
    core.get(
      "SELECT publication_status, published_state FROM github_commit_statuses",
    ),
    { publication_status: "succeeded", published_state: "pending" },
  );
  assert.deepEqual(
    core.get(
      `SELECT attempt_count, external_id, reconciliation_required
       FROM github_delivery_attempts
       WHERE surface = 'commit_status'`,
    ),
    { attempt_count: 2, external_id: 904, reconciliation_required: 0 },
  );
});
