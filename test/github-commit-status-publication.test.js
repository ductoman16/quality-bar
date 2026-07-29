import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { GitHubConnectionError } from "../src/github-connection-error.js";
import { retireGitHubConnection } from "../src/github-connection-lifecycle.js";
import { createGitHubCommitStatusService } from "../src/github-commit-status-service.js";

/** @param {ReturnType<typeof openDurableCore>} core */
function arrange(core) {
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
    "INSERT INTO github_connection_credentials (connection_id, encrypted_credential, created_at) VALUES ('connection-1', 'encrypted', 1)",
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
  const base = "1".repeat(40);
  const head = "2".repeat(40);
  core.run(
    `INSERT INTO evaluations (
       id, repository_id, provenance,
       base_selector_type, base_selector_value,
       head_selector_type, head_selector_value,
       base_commit, head_commit, execution_status, created_at
     ) VALUES (
       'evaluation-1', 'repository-1', 'explicit',
       'commit', ?, 'commit', ?, ?, ?, 'queued', 2
     )`,
    base,
    head,
    base,
    head,
  );
  core.run(
    "UPDATE evaluations SET applicability_sealed_at = 2 WHERE id = 'evaluation-1'",
  );
  core.run(
    `INSERT INTO github_automatic_evaluations (
       evaluation_id, repository_id, pull_request_number,
       base_commit, head_commit
     ) VALUES ('evaluation-1', 'repository-1', 17, ?, ?)`,
    base,
    head,
  );
  return head;
}

test("status publication records success and the exact owning GitHub failure", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-github-status-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  const head = arrange(core);
  /** @type {any[][]} */
  const publications = [];
  /** @type {GitHubConnectionError | null} */
  let failure = null;
  const service = createGitHubCommitStatusService(core, {
    cipher: {
      decrypt() {
        return {
          client_id: "Iv1.client",
          installation_id: 73,
          pem: "private-key",
        };
      },
    },
    externalOrigin: "https://quality-bar.example",
    now: () => 10,
    verifier: {
      async publishCommitStatus(...parameters) {
        if (failure) {
          throw failure;
        }
        publications.push(parameters);
      },
    },
  });

  await service.publishWaiting();
  assert.deepEqual(publications[0].slice(1), [
    73,
    { full_name: "operator/repository", id: 101 },
    {
      description: "Quality Bar Evaluation is active",
      head,
      state: "pending",
      targetUrl:
        "https://quality-bar.example/?view=evaluations&evaluation_id=evaluation-1",
    },
  ]);
  assert.deepEqual(
    core.get(
      `SELECT publication_status, published_state, published_at,
              error_code, error_detail
         FROM github_commit_statuses`,
    ),
    {
      error_code: null,
      error_detail: null,
      publication_status: "succeeded",
      published_at: 10,
      published_state: "pending",
    },
  );

  core.run(
    `INSERT INTO evaluation_results (evaluation_id, outcome, completed_at)
     VALUES ('evaluation-1', 'error', 11)`,
  );
  failure = new GitHubConnectionError(
    "github_api_request_failed",
    "GitHub API request failed with HTTP 403",
  );
  await service.publishWaiting();
  assert.deepEqual(
    core.get(
      `SELECT desired_state, publication_status, error_code, error_detail
         FROM github_commit_statuses`,
    ),
    {
      desired_state: "error",
      error_code: "github_api_request_failed",
      error_detail: "GitHub API request failed with HTTP 403",
      publication_status: "unavailable",
    },
  );
  core.close();
});

test("an in-flight older status restores the latest Evaluation before publication yields", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-github-status-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  const head = arrange(core);
  core.run(
    `INSERT INTO evaluation_results (evaluation_id, outcome, completed_at)
     VALUES ('evaluation-1', 'blocking', 3)`,
  );
  const firstStarted = Promise.withResolvers();
  const releaseFirst = Promise.withResolvers();
  /** @type {string[]} */
  const states = [];
  const service = createGitHubCommitStatusService(core, {
    cipher: {
      decrypt() {
        return {
          client_id: "Iv1.client",
          installation_id: 73,
          pem: "private-key",
        };
      },
    },
    externalOrigin: "https://quality-bar.example",
    now: () => 10,
    verifier: {
      async publishCommitStatus(...parameters) {
        const status = parameters[3];
        states.push(status.state);
        if (states.length === 1) {
          firstStarted.resolve(undefined);
          await releaseFirst.promise;
        }
      },
    },
  });

  const publishing = service.publishWaiting();
  await firstStarted.promise;
  const base = "3".repeat(40);
  core.run(
    `INSERT INTO evaluations (
       id, repository_id, provenance,
       base_selector_type, base_selector_value,
       head_selector_type, head_selector_value,
       base_commit, head_commit, execution_status, created_at
     ) VALUES (
       'evaluation-2', 'repository-1', 'explicit',
       'commit', ?, 'commit', ?, ?, ?, 'queued', 4
     )`,
    base,
    head,
    base,
    head,
  );
  releaseFirst.resolve(undefined);
  await publishing;

  assert.deepEqual(states, ["failure", "pending"]);
  assert.deepEqual(
    core.get(
      `SELECT evaluation_id, desired_state, publication_status, published_state
         FROM github_commit_statuses`,
    ),
    {
      desired_state: "pending",
      evaluation_id: "evaluation-2",
      publication_status: "succeeded",
      published_state: "pending",
    },
  );
  core.close();
});

test("GitHub Connection retirement makes every waiting status exactly unavailable", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-github-status-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  arrange(core);
  core.run(
    "UPDATE repositories SET lifecycle = 'retired' WHERE id = 'repository-1'",
  );

  retireGitHubConnection(core, { lifecycle: "retired" });
  core.run(
    `INSERT INTO evaluation_results (evaluation_id, outcome, completed_at)
     VALUES ('evaluation-1', 'clear', 3)`,
  );

  assert.deepEqual(
    core.get(
      `SELECT desired_state, publication_status, error_code, error_detail
         FROM github_commit_statuses`,
    ),
    {
      desired_state: "success",
      error_code: "github_connection_retired",
      error_detail:
        "GitHub commit status publication is unavailable because the GitHub Connection is retired",
      publication_status: "unavailable",
    },
  );
  assert.deepEqual(
    core.get(
      "SELECT publication_status, error_code, error_detail FROM github_feedback_bundles",
    ),
    {
      error_code: "github_connection_retired",
      error_detail:
        "GitHub feedback publication is unavailable because the GitHub Connection is retired",
      publication_status: "unavailable",
    },
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM github_connection_credentials")
      ?.count,
    0,
  );
  core.close();
});
