import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { readGitHubConnection } from "../src/github-connection-read.js";
import { openDurableCore } from "../src/durable-core.js";

const capabilities = {
  aggregate_feedback: "verified",
  branch_access: "verified",
  commit_status: "verified",
  enumeration: "verified",
  inline_feedback: "verified",
  private_git_read: "verified",
  pull_request_access: "verified",
};

test("SQLite migrates completed GitHub Connection history to stable Forge Repository identity", (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-github-repository-migration-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const databasePath = join(directory, "quality-bar.sqlite3");
  const prior = openDurableCore(databasePath);
  prior.run(
    `INSERT INTO github_connections (
       id, app_id, app_slug, installation_id, principal_id, principal_login,
       api_profile, permissions, capabilities, repository_count, created_at,
       verified_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "legacy-connection",
    47,
    "quality-bar-personal",
    73,
    91,
    "operator",
    "github-rest:2026-03-10",
    JSON.stringify({
      contents: "read",
      issues: "write",
      metadata: "read",
      pull_requests: "write",
      statuses: "write",
    }),
    JSON.stringify(capabilities),
    1,
    1_000,
    1_000,
  );
  prior.run(
    `INSERT INTO github_connection_verifications (
       id, connection_id, trigger, outcome, error_code, error_message,
       error_repository_id, api_profile, principal_id, principal_login,
       permissions, capabilities, affected_repository_ids, repository_checks,
       repositories, verified_at
     ) VALUES (?, ?, ?, 'success', NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "legacy-verification",
    "legacy-connection",
    "onboarding",
    "github-rest:2026-03-10",
    91,
    "operator",
    JSON.stringify({
      contents: "read",
      issues: "write",
      metadata: "read",
      pull_requests: "write",
      statuses: "write",
    }),
    JSON.stringify(capabilities),
    JSON.stringify([101]),
    JSON.stringify([{ outcome: "success", repository_id: 101 }]),
    JSON.stringify([
      {
        clone_url: "https://github.com/operator/legacy.git",
        full_name: "operator/legacy",
        id: 101,
        private: true,
      },
    ]),
    1_000,
  );
  prior.run("DROP TABLE github_repositories");
  prior.run("DROP TRIGGER github_connection_verification_immutable_update");
  prior.run("DROP TRIGGER github_connection_verification_immutable_delete");
  prior.run(
    `ALTER TABLE github_connection_verifications
       RENAME TO github_connection_verifications_v14`,
  );
  prior.run(
    `CREATE TABLE github_connection_verifications (
       id TEXT PRIMARY KEY,
       connection_id TEXT NOT NULL REFERENCES github_connections(id),
       trigger TEXT NOT NULL CHECK (trigger IN ('onboarding')),
       api_profile TEXT NOT NULL,
       principal_id INTEGER NOT NULL CHECK (principal_id > 0),
       principal_login TEXT NOT NULL CHECK (length(principal_login) > 0),
       permissions TEXT NOT NULL CHECK (json_valid(permissions)),
       capabilities TEXT NOT NULL CHECK (json_valid(capabilities)),
       repositories TEXT NOT NULL CHECK (json_valid(repositories)),
       verified_at INTEGER NOT NULL
     ) STRICT`,
  );
  prior.run(
    `INSERT INTO github_connection_verifications (
       id, connection_id, trigger, api_profile, principal_id,
       principal_login, permissions, capabilities, repositories, verified_at
     )
     SELECT
       id, connection_id, trigger, api_profile, principal_id,
       principal_login, permissions, capabilities, repositories, verified_at
     FROM github_connection_verifications_v14`,
  );
  prior.run("DROP TABLE github_connection_verifications_v14");
  prior.run(
    `CREATE TRIGGER github_connection_verification_immutable_update
       BEFORE UPDATE ON github_connection_verifications
       BEGIN
         SELECT RAISE(ABORT, 'github_connection_verification_immutable');
       END`,
  );
  prior.run(
    `CREATE TRIGGER github_connection_verification_immutable_delete
       BEFORE DELETE ON github_connection_verifications
       BEGIN
         SELECT RAISE(ABORT, 'github_connection_verification_immutable');
       END`,
  );
  prior.run("DROP TRIGGER github_connection_health_valid_insert");
  prior.run("DROP TRIGGER github_connection_health_valid_update");
  prior.run("ALTER TABLE github_connections DROP COLUMN health_error_message");
  prior.run("ALTER TABLE github_connections DROP COLUMN health_error_code");
  prior.run("ALTER TABLE github_connections DROP COLUMN health");
  prior.run(
    "UPDATE quality_bar_metadata SET value = '13' WHERE key = 'schema_version'",
  );
  prior.run("PRAGMA user_version = 13");
  prior.close();

  const migrated = openDurableCore(databasePath);
  assert.equal(migrated.facts.schemaVersion, 14);
  assert.deepEqual(
    migrated.get(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'github_repositories'",
    ),
    { name: "github_repositories" },
  );
  assert.deepEqual(
    readGitHubConnection(migrated)?.verification_history[0].repositories,
    [
      {
        clone_url: "https://github.com/operator/legacy.git",
        full_name: "operator/legacy",
        id: 101,
        private: true,
      },
    ],
  );
  assert.equal(readGitHubConnection(migrated)?.health, "healthy");
  assert.equal(readGitHubConnection(migrated)?.health_error, null);
  assert.equal(
    readGitHubConnection(migrated)?.verification_history[0].outcome,
    "success",
  );
  assert.equal(
    readGitHubConnection(migrated)?.verification_history[0].error,
    null,
  );
  assert.throws(
    () =>
      migrated.run(
        `UPDATE github_connections
         SET health_error_code = 'stale',
             health_error_message = 'stale'
         WHERE id = 'legacy-connection'`,
      ),
    /github_connection_health_invalid/,
  );
  assert.throws(
    () =>
      migrated.run(
        `UPDATE github_connections
         SET health = 'error'
         WHERE id = 'legacy-connection'`,
      ),
    /github_connection_health_invalid/,
  );
  migrated.close();
});
