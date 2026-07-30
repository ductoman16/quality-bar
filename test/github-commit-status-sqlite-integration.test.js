import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";

import { openDurableCore } from "../src/durable-core.js";

/**
 * @param {ReturnType<typeof openDurableCore>} core
 * @param {string} id
 * @param {string} head
 * @param {number} createdAt
 */
function insertEvaluation(core, id, head, createdAt) {
  const base = String(createdAt).repeat(40);
  core.run(
    `INSERT INTO evaluations (
       id, repository_id, provenance,
       base_selector_type, base_selector_value,
       head_selector_type, head_selector_value,
       base_commit, head_commit, execution_status, created_at
     ) VALUES (?, 'repository-1', 'explicit',
       'commit', ?, 'commit', ?, ?, ?, 'queued', ?)`,
    id,
    base,
    head,
    base,
    head,
    createdAt,
  );
  core.run(
    "UPDATE evaluations SET applicability_sealed_at = ? WHERE id = ?",
    createdAt,
    id,
  );
  core.run(
    `INSERT INTO github_automatic_evaluations (
       evaluation_id, repository_id, pull_request_number,
       base_commit, head_commit
     ) VALUES (?, 'repository-1', ?, ?, ?)`,
    id,
    createdAt,
    base,
    head,
  );
}

/** @param {ReturnType<typeof openDurableCore>} core */
function arrangeGitHubRepository(core) {
  core.run(
    "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES ('repository-1', 'https://github.com/operator/repository.git', 1, 1)",
  );
  core.run(
    `INSERT INTO github_connections (
       id, app_id, app_slug, installation_id, principal_id, principal_login,
       api_profile, permissions, capabilities, repository_count,
       created_at, verified_at
     ) VALUES (
       'connection-1', 47, 'quality-bar', 73, 91, 'operator',
       'github-rest:2026-03-10', '{}', '{}', 1, 1, 1
     )`,
  );
  core.run(
    `INSERT INTO github_connection_verifications (
       id, connection_id, trigger, outcome, api_profile,
       principal_id, principal_login, permissions, capabilities,
       affected_repository_ids, repository_checks, repositories, verified_at
     ) VALUES (
       'verification-1', 'connection-1', 'onboarding', 'success',
       'github-rest:2026-03-10', 91, 'operator', '{}', '{}',
       '[101]', '[{"repository_id":101,"outcome":"success"}]',
       '[{"api_url":"https://api.github.com/repos/operator/repository","clone_url":"https://github.com/operator/repository.git","full_name":"operator/repository","html_url":"https://github.com/operator/repository","id":101,"private":true}]',
       1
     )`,
  );
  core.run(
    `INSERT INTO github_repositories (
       repository_id, connection_id, verification_id,
       forge_repository_id, name, api_url, web_url
     ) VALUES (
       'repository-1', 'connection-1', 'verification-1', 101,
       'operator/repository',
       'https://api.github.com/repos/operator/repository',
       'https://github.com/operator/repository'
     )`,
  );
}

test("SQLite lets only the latest Evaluation for an exact head control its GitHub status", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-github-status-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  arrangeGitHubRepository(core);
  const head = "2".repeat(40);
  insertEvaluation(core, "evaluation-older", head, 2);
  assert.deepEqual(
    core.get(
      `SELECT evaluation_id, desired_state, publication_status
         FROM github_commit_statuses`,
    ),
    {
      desired_state: "pending",
      evaluation_id: "evaluation-older",
      publication_status: "waiting",
    },
  );

  insertEvaluation(core, "evaluation-latest", head, 3);
  core.run(
    `INSERT INTO evaluation_results (evaluation_id, outcome, completed_at)
     VALUES ('evaluation-older', 'clear', 4)`,
  );
  assert.deepEqual(
    core.get(
      `SELECT evaluation_id, desired_state, publication_status
         FROM github_commit_statuses`,
    ),
    {
      desired_state: "pending",
      evaluation_id: "evaluation-latest",
      publication_status: "waiting",
    },
  );

  core.run(
    `INSERT INTO evaluation_results (evaluation_id, outcome, completed_at)
     VALUES ('evaluation-latest', 'blocking', 5)`,
  );
  assert.deepEqual(
    core.get(
      `SELECT evaluation_id, desired_state, publication_status
         FROM github_commit_statuses`,
    ),
    {
      desired_state: "failure",
      evaluation_id: "evaluation-latest",
      publication_status: "waiting",
    },
  );
  core.close();
});

test("schema 36 backfills a retired Connection status as exactly unavailable", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-github-status-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const databasePath = join(directory, "quality-bar.sqlite3");
  const current = openDurableCore(databasePath);
  arrangeGitHubRepository(current);
  insertEvaluation(current, "evaluation-1", "2".repeat(40), 2);
  current.run(
    "UPDATE repositories SET lifecycle = 'retired' WHERE id = 'repository-1'",
  );
  current.run(
    "UPDATE github_connections SET lifecycle = 'retired' WHERE id = 'connection-1'",
  );
  current.run(
    "DELETE FROM github_connection_credentials WHERE connection_id = 'connection-1'",
  );
  current.close();
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    DROP TRIGGER github_commit_status_admit;
    DROP TRIGGER github_commit_status_complete;
    DROP TABLE github_commit_statuses;
    UPDATE quality_bar_metadata SET value = '36'
      WHERE key = 'schema_version';
    PRAGMA user_version = 36;
  `);
  legacy.close();

  const migrated = openDurableCore(databasePath);
  assert.equal(migrated.facts.schemaVersion, 40);
  assert.equal(
    migrated.get(
      `SELECT count(*) AS count FROM sqlite_schema
        WHERE type = 'table' AND name = 'github_commit_statuses'`,
    )?.count,
    1,
  );
  assert.deepEqual(
    migrated.get(
      `SELECT desired_state, publication_status, error_code, error_detail
         FROM github_commit_statuses`,
    ),
    {
      desired_state: "pending",
      error_code: "github_connection_retired",
      error_detail:
        "GitHub commit status publication is unavailable because the GitHub Connection is retired",
      publication_status: "unavailable",
    },
  );
  migrated.close();
});
