import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";

import { openDurableCore } from "../src/durable-core.js";
import { createEvaluationService } from "../src/evaluation.js";
import { createGitHubPollingRunner } from "../src/github-polling-runner.js";
import { createReviewService } from "../src/review.js";
import {
  availableStorageReserve,
  seedDueGitHubPoll,
} from "./storage-reserve-support.js";

/** @param {number} number @param {Partial<{draft: boolean, head: {sha: string}}>} [overrides] */
function pullRequest(number, overrides = {}) {
  return {
    base: { sha: "a".repeat(40) },
    draft: false,
    head: { sha: "b".repeat(40) },
    merged_at: null,
    number,
    state: "open",
    ...overrides,
  };
}

test("automatic Evaluation admission is durably unique for one frozen Changeset", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-github-auto-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  core.run(
    "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES (?, ?, ?, ?)",
    "repository-1",
    "https://github.com/operator/repository.git",
    1,
    1,
  );
  let reviewId = 0;
  createReviewService(core, {
    createId: () => `review-fact-${++reviewId}`,
    now: () => 2,
  }).create({
    assignment: { scope: "installation_wide" },
    codex_configuration: {
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      service_tier: "standard",
    },
    criteria: [
      {
        impact: "blocking",
        instruction: "Review the newly ready pull request.",
      },
    ],
    description: "Automatic GitHub Evaluation proof",
    name: "Automatic GitHub Review",
  });
  let nextId = 0;
  let nextReviewRunId = 0;
  const service = createEvaluationService(core, {
    acquireChangeset: async () => {
      throw new Error("automatic admission already owns a frozen Changeset");
    },
    createId: () => `evaluation-${++nextId}`,
    createReviewRunId: () => `review-run-${++nextReviewRunId}`,
    readCodexCapabilityFailure: () => null,
    masterKey: Buffer.alloc(32, 7),
    now: () => 10,
    storageReserve: { assertWorkAdmissionAvailable() {} },
  });
  const input = {
    changeset: {
      base_commit: "1".repeat(40),
      head_commit: "2".repeat(40),
    },
    pullRequestNumber: 17,
    repositoryId: "repository-1",
  };

  const createdAdmission = core.transaction((transaction) =>
    service.admitAutomatic(transaction, input),
  );
  createdAdmission.afterCommit();
  const replayAdmission = core.transaction((transaction) =>
    service.admitAutomatic(transaction, input),
  );
  replayAdmission.afterCommit();
  const created = createdAdmission.resource;
  const replay = replayAdmission.resource;

  assert.deepEqual(replay, created);
  assert.equal(created.provenance, "automatic");
  assert.deepEqual(created.pull_request, { number: 17 });
  assert.equal(created.execution_status, "queued");
  assert.deepEqual(created.base_selector, {
    type: "commit",
    value: "1".repeat(40),
  });
  assert.deepEqual(created.head_selector, {
    type: "commit",
    value: "2".repeat(40),
  });
  assert.equal(core.get("SELECT count(*) AS count FROM evaluations")?.count, 1);
  assert.deepEqual(
    core.get(
      `SELECT review_runs.id, codex_execution_queue.work_kind
         FROM review_runs
         JOIN codex_execution_queue
           ON codex_execution_queue.work_id = review_runs.id`,
    ),
    { id: "review-run-1", work_kind: "review_run" },
  );
  assert.deepEqual(
    core.get(
      `SELECT pull_request_number, repository_id, base_commit, head_commit
         FROM github_automatic_evaluations`,
    ),
    {
      base_commit: "1".repeat(40),
      head_commit: "2".repeat(40),
      pull_request_number: 17,
      repository_id: "repository-1",
    },
  );
  core.close();
});

test("schema 34 upgrades the durable automatic Evaluation uniqueness boundary", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-github-auto-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const databasePath = join(directory, "quality-bar.sqlite3");
  openDurableCore(databasePath).close();
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    DROP TRIGGER github_feedback_bundle_admit;
    DROP TRIGGER github_feedback_bundle_identity_update;
    DROP TRIGGER github_feedback_bundle_delete;
    DROP TRIGGER github_finding_feedback_identity_update;
    DROP TRIGGER github_finding_feedback_delete;
    DROP TABLE github_finding_feedback;
    DROP TABLE github_feedback_bundles;
    DROP TABLE github_automatic_evaluation_pull_requests;
    DROP TABLE github_automatic_evaluations;
    UPDATE quality_bar_metadata SET value = '34' WHERE key = 'schema_version';
    PRAGMA user_version = 34;
  `);
  legacy.close();

  const migrated = openDurableCore(databasePath);

  assert.equal(migrated.facts.schemaVersion, 39);
  assert.equal(
    migrated.get(
      `SELECT count(*) AS count FROM sqlite_schema
        WHERE type = 'table' AND name = 'github_automatic_evaluations'`,
    )?.count,
    1,
  );
  assert.equal(
    migrated.get(
      `SELECT count(*) AS count FROM sqlite_schema
        WHERE type = 'table'
          AND name = 'github_automatic_evaluation_pull_requests'`,
    )?.count,
    1,
  );
  migrated.close();
});

test("GitHub polling atomically admits one newly ready Changeset and observes drafts", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-github-auto-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  seedDueGitHubPoll(core);
  let nextId = 0;
  const evaluations = createEvaluationService(core, {
    acquireChangeset: async () => {
      throw new Error("automatic polling owns acquisition");
    },
    createId: () => `evaluation-${++nextId}`,
    readCodexCapabilityFailure: () => null,
    masterKey: Buffer.alloc(32, 7),
    now: () => 65_000,
    storageReserve: availableStorageReserve,
  });
  const runner = createGitHubPollingRunner(core, {
    acquirePullRequestChangeset: async () => ({
      base_commit: "1".repeat(40),
      head_commit: "2".repeat(40),
      release() {},
    }),
    admitAutomaticEvaluation: (transaction, input) =>
      evaluations.admitAutomatic(transaction, input),
    cipher: {
      decrypt: () => ({ client_id: null, pem: "private-key" }),
    },
    storageReserve: availableStorageReserve,
    timestamp: () => 65_000,
    verifier: {
      async listPullRequests() {
        return [pullRequest(7), pullRequest(8, { draft: true })];
      },
      async verifyRepositories() {
        throw new Error("repository selection is not exercised");
      },
    },
  });

  await runner.runDue();

  assert.deepEqual(
    core.all(
      `SELECT evaluations.id, github_automatic_evaluations.pull_request_number
         FROM evaluations
         JOIN github_automatic_evaluations
           ON github_automatic_evaluations.evaluation_id = evaluations.id`,
    ),
    [{ id: "evaluation-1", pull_request_number: 7 }],
  );
  assert.equal(
    core.get(
      "SELECT snapshot FROM github_repository_polls WHERE forge_repository_id = 101",
    )?.snapshot,
    JSON.stringify([pullRequest(7), pullRequest(8, { draft: true })]),
  );
  runner.destroy();
  core.close();
});

test("an inaccessible GitHub pull-request head advances no observation or partial work", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-github-auto-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  seedDueGitHubPoll(core);
  const evaluations = createEvaluationService(core, {
    acquireChangeset: async () => {
      throw new Error("automatic polling owns acquisition");
    },
    readCodexCapabilityFailure: () => null,
    masterKey: Buffer.alloc(32, 7),
    storageReserve: availableStorageReserve,
  });
  const runner = createGitHubPollingRunner(core, {
    async acquirePullRequestChangeset() {
      throw Object.assign(
        new Error("GitHub pull request head is inaccessible"),
        { code: "github_pull_request_head_inaccessible" },
      );
    },
    admitAutomaticEvaluation: (transaction, input) =>
      evaluations.admitAutomatic(transaction, input),
    cipher: {
      decrypt: () => ({ client_id: null, pem: "private-key" }),
    },
    storageReserve: availableStorageReserve,
    timestamp: () => 65_000,
    verifier: {
      async listPullRequests() {
        return [pullRequest(7)];
      },
      async verifyRepositories() {
        throw new Error("repository selection is not exercised");
      },
    },
  });

  await runner.runDue();

  assert.equal(
    core.get(
      "SELECT snapshot FROM github_repository_polls WHERE forge_repository_id = 101",
    )?.snapshot,
    "[]",
  );
  assert.equal(
    core.get(
      "SELECT error_code FROM github_repository_polls WHERE forge_repository_id = 101",
    )?.error_code,
    "github_pull_request_head_inaccessible",
  );
  assert.equal(core.get("SELECT count(*) AS count FROM evaluations")?.count, 0);
  runner.destroy();
  core.close();
});

test("automatic Changeset cleanup failure rolls back observation and Evaluation admission", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-github-auto-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  seedDueGitHubPoll(core);
  const evaluations = createEvaluationService(core, {
    acquireChangeset: async () => {
      throw new Error("automatic polling owns acquisition");
    },
    readCodexCapabilityFailure: () => null,
    masterKey: Buffer.alloc(32, 7),
    storageReserve: availableStorageReserve,
  });
  const runner = createGitHubPollingRunner(core, {
    async acquirePullRequestChangeset() {
      return {
        base_commit: "1".repeat(40),
        head_commit: "2".repeat(40),
        release() {
          throw Object.assign(
            new Error("Evaluation Git acquisition cleanup failed"),
            { code: "evaluation_git_acquisition_unavailable" },
          );
        },
      };
    },
    admitAutomaticEvaluation: (transaction, input) =>
      evaluations.admitAutomatic(transaction, input),
    cipher: {
      decrypt: () => ({ client_id: null, pem: "private-key" }),
    },
    storageReserve: availableStorageReserve,
    timestamp: () => 65_000,
    verifier: {
      async listPullRequests() {
        return [pullRequest(7)];
      },
      async verifyRepositories() {
        throw new Error("repository selection is not exercised");
      },
    },
  });

  await runner.runDue();

  assert.equal(
    core.get(
      "SELECT snapshot FROM github_repository_polls WHERE forge_repository_id = 101",
    )?.snapshot,
    "[]",
  );
  assert.equal(
    core.get(
      "SELECT error_code FROM github_repository_polls WHERE forge_repository_id = 101",
    )?.error_code,
    "evaluation_git_acquisition_unavailable",
  );
  assert.equal(core.get("SELECT count(*) AS count FROM evaluations")?.count, 0);
  runner.destroy();
  core.close();
});
