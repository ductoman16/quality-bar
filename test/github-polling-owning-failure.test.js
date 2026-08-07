import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { GitHubConnectionError } from "../src/github-connection-error.js";
import { openDurableCore } from "../src/durable-core.js";
import { recordGitHubPollingOwningFailure } from "../src/github-polling-owning-failure.js";

/** @param {import("node:test").TestContext} context */
function createCore(context) {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-github-poll-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  core.run(
    `INSERT INTO github_connections (
       id, app_id, app_slug, installation_id, principal_id, principal_login,
       api_profile, permissions, capabilities, repository_count,
       created_at, verified_at
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
    1,
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
    "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES (?, ?, ?, ?)",
    "repository-1",
    "https://github.com/operator/private.git",
    1,
    1,
  );
  core.run(
    `INSERT INTO github_repositories (
       repository_id, connection_id, forge_repository_id, name, api_url,
       web_url, verification_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    "repository-1",
    "connection-1",
    101,
    "operator/private",
    "https://api.github.com/repos/operator/private",
    "https://github.com/operator/private",
    "verification-1",
  );
  return core;
}

test("a definitive GitHub credential failure belongs to its Connection", (context) => {
  const core = createCore(context);
  const failure = new GitHubConnectionError(
    "github_connection_credential_undecryptable",
    "GitHub Connection credential cannot be decrypted",
  );
  core.transaction((transaction) => {
    recordGitHubPollingOwningFailure(
      transaction,
      "connection-1",
      [101],
      failure,
      5_000,
    );
  });
  assert.deepEqual(
    core.get(
      "SELECT health, health_error_code, health_error_message, verified_at FROM github_connections",
    ),
    {
      health: "error",
      health_error_code: "github_connection_credential_undecryptable",
      health_error_message: "GitHub Connection credential cannot be decrypted",
      verified_at: 5_000,
    },
  );
});

test("a definitive GitHub Repository failure belongs to its Repository", (context) => {
  const core = createCore(context);
  const failure = new GitHubConnectionError(
    "github_repository_api_access_failed",
    "GitHub Repository API access verification failed",
    { repositoryId: 101 },
  );
  core.transaction((transaction) => {
    recordGitHubPollingOwningFailure(
      transaction,
      "connection-1",
      [101],
      failure,
      5_000,
    );
  });
  assert.deepEqual(
    core.get(
      "SELECT health, health_error_code, health_error_message, verified_at FROM repositories",
    ),
    {
      health: "error",
      health_error_code: "github_repository_api_access_failed",
      health_error_message: "GitHub Repository API access verification failed",
      verified_at: 5_000,
    },
  );
});
