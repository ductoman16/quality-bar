import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";

import { openDurableCore } from "../src/durable-core.js";
import { createEvaluationService } from "../src/evaluation.js";
import { createForgejoConnectionService } from "../src/forgejo-connection.js";
import { createReviewService } from "../src/review.js";
import {
  forgejoVerification,
  repositoryEvidence,
} from "./forgejo-polling-sqlite-integration-support.js";
import { availableStorageReserve } from "./storage-reserve-support.js";

test("Forgejo automatic Evaluation admission is durable, unique, and provider-owned", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-forgejo-auto-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  core.run(
    "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES (?, ?, ?, ?)",
    "repository-1",
    "https://forgejo.example/operator/repository.git",
    1,
    1,
  );
  createReviewService(core, {
    createId: (() => {
      let id = 0;
      return () => `review-fact-${++id}`;
    })(),
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
        instruction: "Review the newly ready Forgejo pull request.",
      },
    ],
    description: "Automatic Forgejo Evaluation proof",
    name: "Automatic Forgejo Review",
  });
  let nextEvaluationId = 0;
  let nextReviewRunId = 0;
  const service = createEvaluationService(core, {
    acquireChangeset: async () => {
      throw new Error("automatic admission already owns a frozen Changeset");
    },
    createId: () => `evaluation-${++nextEvaluationId}`,
    createReviewRunId: () => `review-run-${++nextReviewRunId}`,
    readCodexCapabilityFailure: () => null,
    masterKey: Buffer.alloc(32, 7),
    now: () => 10,
    storageReserve: availableStorageReserve,
  });
  const input = {
    changeset: {
      base_commit: "1".repeat(40),
      head_commit: "2".repeat(40),
    },
    provider: /** @type {const} */ ("forgejo"),
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

  assert.deepEqual(replayAdmission.resource, createdAdmission.resource);
  assert.equal(createdAdmission.resource.provenance, "automatic");
  assert.deepEqual(createdAdmission.resource.pull_request, { number: 17 });
  assert.equal(core.get("SELECT count(*) AS count FROM evaluations")?.count, 1);
  assert.equal(
    core.get("SELECT count(*) AS count FROM forgejo_automatic_evaluations")
      ?.count,
    1,
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM github_automatic_evaluations")
      ?.count,
    0,
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM github_commit_statuses")?.count,
    0,
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM github_feedback_bundles")?.count,
    0,
  );
  core.close();
});

test("schema 48 adds the Forgejo automatic Evaluation boundary", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-forgejo-auto-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const databasePath = join(directory, "quality-bar.sqlite3");
  openDurableCore(databasePath).close();
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    DROP TABLE forgejo_automatic_evaluation_pull_requests;
    DROP TABLE forgejo_automatic_evaluations;
    UPDATE quality_bar_metadata SET value = '48' WHERE key = 'schema_version';
    PRAGMA user_version = 48;
  `);
  legacy.close();

  const migrated = openDurableCore(databasePath);
  assert.equal(migrated.facts.schemaVersion, 52);
  assert.deepEqual(
    migrated.all(
      `SELECT name FROM sqlite_schema
        WHERE type = 'table' AND name LIKE 'forgejo_automatic_evaluation%'
        ORDER BY name`,
    ),
    [
      { name: "forgejo_automatic_evaluation_pull_requests" },
      { name: "forgejo_automatic_evaluations" },
    ],
  );
  migrated.close();
});

/** @param {number} number @param {Partial<{draft: boolean}>} [overrides] */
function pullRequest(number, overrides = {}) {
  return {
    base: { sha: "a".repeat(40) },
    draft: false,
    head: { sha: "b".repeat(40) },
    merge_base: "c".repeat(40),
    merged: false,
    merged_at: null,
    number,
    state: "open",
    ...overrides,
  };
}

test("Forgejo polling atomically admits a newly ready PR and observes a draft", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-forgejo-auto-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  createReviewService(core, {
    createId: (() => {
      let id = 0;
      return () => `review-fact-${++id}`;
    })(),
    now: () => 2,
  }).create({
    assignment: { scope: "installation_wide" },
    codex_configuration: {
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      service_tier: "standard",
    },
    criteria: [{ impact: "blocking", instruction: "Review Forgejo PR." }],
    description: "Automatic Forgejo polling proof",
    name: "Forgejo polling Review",
  });
  let nextEvaluationId = 0;
  const evaluations = createEvaluationService(core, {
    acquireChangeset: async () => {
      throw new Error("automatic polling owns acquisition");
    },
    createId: () => `evaluation-${++nextEvaluationId}`,
    readCodexCapabilityFailure: () => null,
    masterKey: Buffer.alloc(32, 7),
    now: () => 61_000,
    storageReserve: availableStorageReserve,
  });
  let currentTime = 1_000;
  let observed = [pullRequest(17, { draft: true })];
  let releases = 0;
  /** @type {Map<number, Error & {code: string}>} */
  const acquisitionFailures = new Map();
  const connection = createForgejoConnectionService(core, {
    async acquirePullRequestChangeset({ pullRequest, repositoryId }) {
      if (acquisitionFailures.has(pullRequest.number)) {
        throw acquisitionFailures.get(pullRequest.number);
      }
      assert.equal(repositoryId, "repository-1");
      return {
        base_commit: (pullRequest.number === 17 ? "1" : "3").repeat(40),
        head_commit: (pullRequest.number === 17 ? "2" : "4").repeat(40),
        release() {
          releases += 1;
        },
      };
    },
    admitAutomaticEvaluation: (transaction, input) =>
      evaluations.admitAutomatic(transaction, input),
    createId: (() => {
      const ids = ["connection-1", "verification-1", "repository-1"];
      return () => ids.shift();
    })(),
    masterKey: Buffer.alloc(32, 8),
    now: () => currentTime,
    storageReserve: availableStorageReserve,
    verifier: {
      async listPullRequests() {
        return observed;
      },
      async verify() {
        return forgejoVerification([repositoryEvidence(11, "private")]);
      },
    },
  });
  await connection.connect({
    base_url: "https://forgejo.example",
    repository_ids: [11],
    token: "pat",
  });

  currentTime = 61_000;
  observed = [pullRequest(17), pullRequest(18, { draft: true })];
  await connection.runPolling();

  assert.deepEqual(
    core.all(
      `SELECT evaluations.id, forgejo_automatic_evaluations.pull_request_number,
              evaluations.base_commit, evaluations.head_commit
         FROM evaluations
         JOIN forgejo_automatic_evaluations
           ON forgejo_automatic_evaluations.evaluation_id = evaluations.id`,
    ),
    [
      {
        base_commit: "1".repeat(40),
        head_commit: "2".repeat(40),
        id: "evaluation-1",
        pull_request_number: 17,
      },
    ],
  );
  assert.equal(releases, 1);
  assert.equal(
    core.get("SELECT snapshot FROM forgejo_repository_polls")?.snapshot,
    JSON.stringify(observed),
  );

  const lastSuccessfulSnapshot = JSON.stringify(observed);
  currentTime = 121_000;
  observed = [...observed, pullRequest(19), pullRequest(20), pullRequest(21)];
  acquisitionFailures.set(
    19,
    Object.assign(new Error("Forgejo pull request head is inaccessible"), {
      code: "forgejo_pull_request_head_inaccessible",
    }),
  );
  acquisitionFailures.set(
    20,
    Object.assign(new Error("Repository disappeared"), {
      code: "repository_git_read_failed",
    }),
  );
  await connection.runPolling();

  assert.deepEqual(
    core.get(
      `SELECT error_code, error_message, snapshot
         FROM forgejo_repository_polls`,
    ),
    {
      error_code: "repository_git_read_failed",
      error_message: `Forgejo pull request #20 at merge-base ${pullRequest(20).merge_base} and head ${pullRequest(20).head.sha}: Repository disappeared`,
      snapshot: lastSuccessfulSnapshot,
    },
  );
  assert.deepEqual(
    core.all(
      `SELECT forgejo_automatic_evaluations.pull_request_number
         FROM forgejo_automatic_evaluations ORDER BY pull_request_number`,
    ),
    [{ pull_request_number: 17 }, { pull_request_number: 21 }],
  );
  assert.equal(releases, 2);
  assert.deepEqual(
    core.get("SELECT health, health_error_code FROM repositories"),
    {
      health: "error",
      health_error_code: "repository_git_read_failed",
    },
  );
  connection.destroy();
  core.close();
});
