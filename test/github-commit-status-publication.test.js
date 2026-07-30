import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { GitHubConnectionError } from "../src/github-connection-error.js";
import { retireGitHubConnection } from "../src/github-connection-lifecycle.js";
import { createGitHubCommitStatusService } from "../src/github-commit-status-service.js";
import { arrangeGitHubCommitStatus } from "./github-commit-status-publication-support.js";

test("status publication records success and the exact owning GitHub failure", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-github-status-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  const head = arrangeGitHubCommitStatus(core);
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
        return 901;
      },
      async reconcileCommitStatus() {
        return null;
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
  const head = arrangeGitHubCommitStatus(core);
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
        return 900 + states.length;
      },
      async reconcileCommitStatus() {
        return null;
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
  arrangeGitHubCommitStatus(core);
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
