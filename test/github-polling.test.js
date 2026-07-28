import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { GitHubConnectionError } from "../src/github-connection-error.js";
import {
  GITHUB_POLL_INTERVAL_MS,
  createGitHubPollingService,
} from "../src/github-polling.js";
import { openDurableCore } from "../src/durable-core.js";
import { readGitHubPollingFailure } from "../src/github-polling-read.js";
import { createAvailableGitHubPollingRunner as createGitHubPollingRunner } from "./storage-reserve-support.js";

/** @param {number} number */
function pullRequest(number) {
  return {
    base: { sha: "a".repeat(40) },
    draft: false,
    head: { sha: "b".repeat(40) },
    merged_at: null,
    number,
    state: "open",
  };
}

test("a complete GitHub baseline absorbs every page before it makes polling effective", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-github-poll-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  core.run(
    `INSERT INTO github_connections (
       id, app_id, app_slug, installation_id, principal_id, principal_login,
       api_profile, permissions, capabilities, repository_count, created_at, verified_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "connection-1",
    47,
    "quality-bar",
    73,
    91,
    "operator",
    "github-rest:2026-03-10",
    "{}",
    "{}",
    2,
    1_000,
    1_000,
  );
  /** @type {number[]} */
  const seen = [];
  const polling = createGitHubPollingService(core, {
    async fetchPullRequests({ repository }) {
      seen.push(repository.id);
      return repository.id === 101 ? [pullRequest(1), pullRequest(2)] : [];
    },
    now: () => 5_000,
    recordOwningFailure() {},
  });

  await polling.baseline({
    connection: { id: "connection-1" },
    credential: {},
    repositories: [{ id: 101 }, { id: 202 }],
  });

  assert.deepEqual(seen, [101, 202]);
  assert.deepEqual(
    core.all(
      `SELECT forge_repository_id, baseline_status, last_success_at,
              error_code, rate_gate_until, next_attempt_at, snapshot
         FROM github_repository_polls ORDER BY forge_repository_id`,
    ),
    [
      {
        forge_repository_id: 101,
        baseline_status: "complete",
        last_success_at: 5_000,
        error_code: null,
        rate_gate_until: null,
        next_attempt_at: 5_000 + GITHUB_POLL_INTERVAL_MS,
        snapshot: JSON.stringify([pullRequest(1), pullRequest(2)]),
      },
      {
        forge_repository_id: 202,
        baseline_status: "complete",
        last_success_at: 5_000,
        error_code: null,
        rate_gate_until: null,
        next_attempt_at: 5_000 + GITHUB_POLL_INTERVAL_MS,
        snapshot: "[]",
      },
    ],
  );
  core.close();
});

test("a failed or truncated GitHub baseline advances no observation and exposes its exact gate", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-github-poll-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  core.run(
    `INSERT INTO github_connections (id, app_id, app_slug, installation_id, principal_id, principal_login, api_profile, permissions, capabilities, repository_count, created_at, verified_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "connection-1",
    47,
    "quality-bar",
    73,
    91,
    "operator",
    "github-rest:2026-03-10",
    "{}",
    "{}",
    2,
    1,
    1,
  );
  let requests = 0;
  const polling = createGitHubPollingService(core, {
    async fetchPullRequests({ repository }) {
      requests += 1;
      if (repository.id === 202) {
        throw new GitHubConnectionError(
          "github_api_transient_failure",
          "GitHub API request temporarily failed with HTTP 429",
          { nextAttemptAt: 125_000, repositoryId: 202 },
        );
      }
      return [];
    },
    now: () => 5_000,
    recordOwningFailure() {},
  });

  await assert.rejects(
    () =>
      polling.baseline({
        connection: { id: "connection-1" },
        credential: {},
        repositories: [{ id: 101 }, { id: 202 }],
      }),
    (error) =>
      error instanceof GitHubConnectionError &&
      error.code === "github_api_transient_failure",
  );
  assert.deepEqual(core.all("SELECT * FROM github_repository_polls"), []);
  assert.equal(requests, 2);
  assert.deepEqual(readGitHubPollingFailure(core, "connection-1"), {
    error: {
      code: "github_api_transient_failure",
      message: "GitHub API request temporarily failed with HTTP 429",
    },
    forge_repository_id: 202,
    next_attempt_at: 125_000,
    rate_gate_until: 125_000,
  });
  await assert.rejects(
    () =>
      polling.baseline({
        connection: { id: "connection-1" },
        credential: {},
        repositories: [{ id: 101 }, { id: 202 }],
      }),
    (error) =>
      error instanceof GitHubConnectionError &&
      error.code === "github_api_transient_failure" &&
      error.nextAttemptAt === 125_000,
  );
  assert.deepEqual(core.all("SELECT * FROM github_repository_polls"), []);
  assert.equal(requests, 2);
  core.close();
});

test("GitHub polling fails hard on an unexpected implementation error", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-github-poll-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  const implementationError = new TypeError("fixture implementation failed");
  const polling = createGitHubPollingService(core, {
    async fetchPullRequests() {
      throw implementationError;
    },
    now: () => 5_000,
    recordOwningFailure() {},
  });

  await assert.rejects(
    () =>
      polling.baseline({
        connection: { id: "connection-1" },
        credential: {},
        repositories: [{ id: 101 }],
      }),
    (error) => error === implementationError,
  );
  assert.deepEqual(core.all("SELECT * FROM github_repository_polls"), []);
  core.close();
});

test("due GitHub polling reconciles only enabled healthy state and persists its next attempt", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-github-poll-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  core.run(
    `INSERT INTO github_connections (id, app_id, app_slug, installation_id, principal_id, principal_login, api_profile, permissions, capabilities, repository_count, created_at, verified_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "connection-1",
    47,
    "quality-bar",
    73,
    91,
    "operator",
    "github-rest:2026-03-10",
    "{}",
    "{}",
    2,
    1,
    1,
  );
  core.run(
    "INSERT INTO github_connection_credentials (connection_id, encrypted_credential, created_at) VALUES (?, ?, ?)",
    "connection-1",
    "encrypted",
    1,
  );
  core.run(
    "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES (?, ?, ?, ?)",
    "repository-1",
    "https://github.com/operator/private.git",
    1,
    1,
  );
  core.run(
    "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES (?, ?, ?, ?)",
    "repository-2",
    "https://github.com/operator/second.git",
    1,
    1,
  );
  core.run(
    `INSERT INTO github_connection_verifications (
       id, connection_id, trigger, outcome, api_profile, principal_id,
       principal_login, permissions, capabilities, affected_repository_ids,
       repository_checks, repositories, verified_at
     ) VALUES (?, ?, 'onboarding', 'success', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "verification-1",
    "connection-1",
    "github-rest:2026-03-10",
    91,
    "operator",
    "{}",
    "{}",
    "[101]",
    '[{"repository_id":101,"outcome":"success"}]',
    '[{"id":101}]',
    1,
  );
  core.run(
    `INSERT INTO github_repositories (repository_id, connection_id, forge_repository_id, name, api_url, web_url, verification_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    "repository-1",
    "connection-1",
    101,
    "operator/private",
    "https://api.github.com/repos/operator/private",
    "https://github.com/operator/private",
    "verification-1",
  );
  core.run(
    `INSERT INTO github_repositories (repository_id, connection_id, forge_repository_id, name, api_url, web_url, verification_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    "repository-2",
    "connection-1",
    202,
    "operator/second",
    "https://api.github.com/repos/operator/second",
    "https://github.com/operator/second",
    "verification-1",
  );
  core.run(
    `INSERT INTO github_repository_polls (connection_id, forge_repository_id, baseline_status, last_success_at, next_attempt_at, snapshot)
     VALUES (?, ?, 'complete', ?, ?, ?)`,
    "connection-1",
    101,
    5_000,
    65_000,
    "[]",
  );
  core.run(
    `INSERT INTO github_repository_polls (connection_id, forge_repository_id, baseline_status, last_success_at, next_attempt_at, snapshot)
     VALUES (?, ?, 'pending', NULL, ?, NULL)`,
    "connection-1",
    202,
    0,
  );
  let currentTime = 65_000;
  let rateLimited = false;
  /** @type {Error & {code?: string} | null} */
  let credentialFailure = null;
  /** @type {GitHubConnectionError | null} */
  let providerFailure = null;
  const runner = createGitHubPollingRunner(core, {
    cipher: {
      decrypt() {
        if (credentialFailure) {
          throw credentialFailure;
        }
        return { client_id: null, pem: "private-key" };
      },
    },
    timestamp: () => currentTime,
    verifier: {
      async listPullRequests() {
        if (providerFailure) {
          throw providerFailure;
        }
        if (rateLimited) {
          throw new GitHubConnectionError(
            "github_api_transient_failure",
            "GitHub API request temporarily failed with HTTP 429",
            { nextAttemptAt: 300_000 },
          );
        }
        return [pullRequest(7)];
      },
      async verifyRepositories() {
        throw new Error("repository selection is not exercised");
      },
    },
  });
  await runner.runDue();
  assert.deepEqual(
    core.get(
      "SELECT baseline_status, last_success_at, error_code, next_attempt_at, snapshot FROM github_repository_polls",
    ),
    {
      baseline_status: "complete",
      error_code: null,
      last_success_at: 65_000,
      next_attempt_at: 125_000,
      snapshot: JSON.stringify([pullRequest(7)]),
    },
  );
  rateLimited = true;
  currentTime = 125_000;
  await runner.runDue();
  assert.deepEqual(
    core.all(
      `SELECT baseline_status, last_success_at, error_code, rate_gate_until,
              next_attempt_at, snapshot
         FROM github_repository_polls ORDER BY forge_repository_id`,
    ),
    [101, 202].map(() => ({
      baseline_status: "complete",
      error_code: null,
      last_success_at: 65_000,
      next_attempt_at: 300_000,
      rate_gate_until: 300_000,
      snapshot: JSON.stringify([pullRequest(7)]),
    })),
  );
  assert.equal(
    readGitHubPollingFailure(core, "connection-1")?.error.code,
    "github_api_transient_failure",
  );

  rateLimited = false;
  currentTime = 300_000;
  credentialFailure = Object.assign(
    new Error("GitHub Connection credential cannot be decrypted"),
    { code: "github_connection_credential_undecryptable" },
  );
  await runner.runDue();
  assert.deepEqual(
    core.get(
      "SELECT health, health_error_code, health_error_message FROM github_connections",
    ),
    {
      health: "error",
      health_error_code: "github_connection_credential_undecryptable",
      health_error_message: "GitHub Connection credential cannot be decrypted",
    },
  );
  assert.equal(
    readGitHubPollingFailure(core, "connection-1")?.error.code,
    "github_connection_credential_undecryptable",
  );

  core.run(
    `UPDATE github_connections
        SET health = 'healthy', health_error_code = NULL,
            health_error_message = NULL`,
  );
  core.run("UPDATE github_repository_polls SET next_attempt_at = 360000");
  credentialFailure = null;
  providerFailure = new GitHubConnectionError(
    "github_repository_api_access_failed",
    "GitHub Repository API access verification failed",
    { repositoryId: 101 },
  );
  currentTime = 360_000;
  await runner.runDue();
  assert.deepEqual(
    core.get(
      "SELECT health, health_error_code, health_error_message FROM repositories WHERE id = 'repository-1'",
    ),
    {
      health: "error",
      health_error_code: "github_repository_api_access_failed",
      health_error_message: "GitHub Repository API access verification failed",
    },
  );
  runner.destroy();
  core.close();
});
