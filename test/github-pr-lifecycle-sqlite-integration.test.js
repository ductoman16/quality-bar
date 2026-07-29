import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";

import { openDurableCore } from "../src/durable-core.js";
import { createEvaluationService } from "../src/evaluation.js";
import { createReviewService } from "../src/review.js";
import { availableStorageReserve } from "./storage-reserve-support.js";

const SUPERSESSION = {
  code: "cancelled_by_supersession",
  detail: "Evaluation was superseded by a different pull request Changeset",
};

const LEGACY_EVALUATION_SCHEMA = `
  CREATE TABLE evaluations_v35 (
    id TEXT PRIMARY KEY,
    repository_id TEXT NOT NULL REFERENCES repositories(id),
    provenance TEXT NOT NULL CHECK (provenance = 'explicit'),
    base_selector_type TEXT NOT NULL
      CHECK (base_selector_type IN ('branch', 'commit')),
    base_selector_value TEXT NOT NULL,
    head_selector_type TEXT NOT NULL
      CHECK (head_selector_type IN ('branch', 'commit')),
    head_selector_value TEXT NOT NULL,
    base_commit TEXT NOT NULL CHECK (
      length(base_commit) IN (40, 64)
      AND base_commit NOT GLOB '*[^0-9a-f]*'
    ),
    head_commit TEXT NOT NULL CHECK (
      length(head_commit) IN (40, 64)
      AND head_commit NOT GLOB '*[^0-9a-f]*'
    ),
    execution_status TEXT NOT NULL CHECK (
      execution_status IN (
        'queued',
        'running',
        'completed',
        'failed',
        'cancelled'
      )
    ),
    applicability_sealed_at INTEGER,
    cancellation_requested_at INTEGER,
    cancellation_code TEXT,
    cancellation_detail TEXT,
    next_attempt_at INTEGER,
    created_at INTEGER NOT NULL,
    completed_at INTEGER,
    CHECK (length(base_commit) = length(head_commit)),
    CHECK (next_attempt_at IS NULL OR execution_status = 'queued'),
    CHECK (
      applicability_sealed_at IS NULL
      OR applicability_sealed_at >= created_at
    ),
    CHECK (
      (execution_status = 'cancelled'
        AND cancellation_requested_at IS NOT NULL
        AND cancellation_requested_at >= created_at
        AND completed_at = cancellation_requested_at
        AND cancellation_code = 'cancelled_by_operator'
        AND cancellation_detail IS NOT NULL
        AND length(trim(cancellation_detail)) > 0)
      OR
      (execution_status <> 'cancelled'
        AND cancellation_requested_at IS NULL
        AND cancellation_code IS NULL
        AND cancellation_detail IS NULL)
    )
  ) STRICT;
`;

/** @param {string} base @param {string} head */
function changeset(base, head) {
  return {
    base_commit: base.repeat(40),
    head_commit: head.repeat(40),
  };
}

test("a different GitHub pull-request pair durably supersedes nonterminal work", (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-github-lifecycle-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  core.run(
    "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES (?, ?, ?, ?)",
    "repository-1",
    "https://github.com/operator/repository.git",
    1,
    1,
  );
  let reviewFact = 0;
  createReviewService(core, {
    createId: () => `review-fact-${++reviewFact}`,
    now: () => 2,
  }).create({
    assignment: { scope: "installation_wide" },
    codex_configuration: {
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      service_tier: "standard",
    },
    criteria: [{ impact: "blocking", instruction: "Review this pair." }],
    description: "GitHub lifecycle proof",
    name: "GitHub lifecycle",
  });
  let evaluationId = 0;
  let reviewRunId = 0;
  /** @type {string[]} */
  const signalled = [];
  let timestamp = 10;
  const evaluations = createEvaluationService(core, {
    acquireChangeset: async () => {
      throw new Error("automatic admission owns acquisition");
    },
    createId: () => `evaluation-${++evaluationId}`,
    createReviewRunId: () => `review-run-${++reviewRunId}`,
    masterKey: Buffer.alloc(32, 7),
    now: () => timestamp++,
    readCodexCapabilityFailure: () => null,
    signalCancellations: (workIds) => signalled.push(...workIds),
    storageReserve: availableStorageReserve,
  });
  /**
   * @param {{base_commit: string, head_commit: string}} pair
   * @param {number} [pullRequestNumber]
   */
  const admit = (pair, pullRequestNumber = 17) =>
    core.transaction((transaction) =>
      evaluations.admitAutomatic(transaction, {
        changeset: pair,
        pullRequestNumber,
        repositoryId: "repository-1",
      }),
    );

  const first = admit(changeset("1", "2"));
  first.afterCommit();
  const shared = admit(changeset("1", "2"), 18);
  shared.afterCommit();
  assert.equal(shared.resource.id, "evaluation-1");
  assert.deepEqual(
    core.all(
      `SELECT pull_request_number
         FROM github_automatic_evaluation_pull_requests
        WHERE evaluation_id = 'evaluation-1'
        ORDER BY pull_request_number`,
    ),
    [{ pull_request_number: 17 }, { pull_request_number: 18 }],
  );
  core.run(
    `UPDATE evaluations SET execution_status = 'running'
      WHERE id = 'evaluation-1'`,
  );
  core.run(
    `UPDATE review_runs
        SET execution_status = 'running', started_at = 10
      WHERE id = 'review-run-1'`,
  );
  core.run(
    `UPDATE codex_execution_queue
        SET started_at = 10, worker_id = 'worker-1',
            fencing_token = 1, lease_expires_at = 12000
      WHERE work_id = 'review-run-1'`,
  );

  const second = admit(changeset("1", "3"), 18);

  assert.deepEqual(signalled, []);
  assert.equal(second.resource.id, "evaluation-2");
  assert.deepEqual(
    core.get(
      `SELECT execution_status, cancellation_code, cancellation_detail
         FROM evaluations WHERE id = 'evaluation-1'`,
    ),
    {
      cancellation_code: SUPERSESSION.code,
      cancellation_detail: SUPERSESSION.detail,
      execution_status: "cancelled",
    },
  );
  assert.deepEqual(
    core.get(
      `SELECT execution_status, completed_at
         FROM review_runs WHERE id = 'review-run-1'`,
    ),
    { completed_at: 11, execution_status: "cancelled" },
  );
  assert.deepEqual(
    core.get(
      `SELECT outcome, completed_at
         FROM evaluation_results WHERE evaluation_id = 'evaluation-1'`,
    ),
    { completed_at: 11, outcome: "error" },
  );
  second.afterCommit();
  assert.deepEqual(signalled, ["review-run-1"]);

  const returned = admit(changeset("1", "2"), 18);

  assert.equal(returned.resource.id, "evaluation-1");
  assert.equal(
    core.get(
      "SELECT execution_status FROM evaluations WHERE id = 'evaluation-2'",
    )?.execution_status,
    "cancelled",
  );
  assert.equal(core.get("SELECT count(*) AS count FROM evaluations")?.count, 2);
  returned.afterCommit();
  core.close();
});

test("schema 35 preserves automatic Evaluation references while adding supersession", (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-github-lifecycle-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const databasePath = join(directory, "quality-bar.sqlite3");
  const core = openDurableCore(databasePath);
  core.run(
    "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES (?, ?, ?, ?)",
    "repository-1",
    "https://github.com/operator/repository.git",
    1,
    1,
  );
  core.run(
    `INSERT INTO evaluations (
       id, repository_id, provenance,
       base_selector_type, base_selector_value,
       head_selector_type, head_selector_value,
       base_commit, head_commit, execution_status,
       created_at
     ) VALUES (
       'evaluation-1', 'repository-1', 'explicit',
       'commit', ?, 'commit', ?, ?, ?, 'queued', 2
     )`,
    "1".repeat(40),
    "2".repeat(40),
    "1".repeat(40),
    "2".repeat(40),
  );
  core.run(
    "UPDATE evaluations SET applicability_sealed_at = 2 WHERE id = 'evaluation-1'",
  );
  core.run(
    `INSERT INTO github_automatic_evaluations (
       evaluation_id, repository_id, pull_request_number,
       base_commit, head_commit
     ) VALUES ('evaluation-1', 'repository-1', 17, ?, ?)`,
    "1".repeat(40),
    "2".repeat(40),
  );
  core.close();
  const legacy = new DatabaseSync(databasePath);
  legacy.exec("PRAGMA foreign_keys = OFF");
  legacy.exec(`
    BEGIN IMMEDIATE;
    DROP TRIGGER github_feedback_bundle_admit;
    DROP TRIGGER github_feedback_bundle_identity_update;
    DROP TRIGGER github_feedback_bundle_delete;
    DROP TRIGGER github_finding_feedback_identity_update;
    DROP TRIGGER github_finding_feedback_delete;
    DROP TABLE github_finding_feedback;
    DROP TABLE github_feedback_bundles;
    DROP TABLE github_automatic_evaluation_pull_requests;
    DROP TRIGGER github_automatic_evaluation_matches_evaluation;
    DROP TRIGGER applicability_selection_closed_insert;
    DROP TRIGGER applicability_result_closed_insert;
    ${LEGACY_EVALUATION_SCHEMA}
    INSERT INTO evaluations_v35 SELECT * FROM evaluations;
    DROP TABLE evaluations;
    ALTER TABLE evaluations_v35 RENAME TO evaluations;
    CREATE TRIGGER github_automatic_evaluation_matches_evaluation
      BEFORE INSERT ON github_automatic_evaluations
      WHEN NOT EXISTS (
        SELECT 1 FROM evaluations
        WHERE id = NEW.evaluation_id
          AND repository_id = NEW.repository_id
          AND base_commit = NEW.base_commit
          AND head_commit = NEW.head_commit
      )
      BEGIN
        SELECT RAISE(ABORT, 'github_automatic_evaluation_mismatch');
      END;
    CREATE TRIGGER applicability_selection_closed_insert
      BEFORE INSERT ON applicability_selections
      WHEN (
        SELECT applicability_sealed_at IS NOT NULL
        FROM evaluations
        WHERE id = NEW.evaluation_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'applicability_result_insertion_closed');
      END;
    CREATE TRIGGER applicability_result_closed_insert
      BEFORE INSERT ON applicability_results
      WHEN (
        SELECT applicability_sealed_at IS NOT NULL
        FROM evaluations
        WHERE id = NEW.evaluation_id
      )
      BEGIN
        SELECT RAISE(ABORT, 'applicability_result_insertion_closed');
      END;
    UPDATE quality_bar_metadata SET value = '35' WHERE key = 'schema_version';
    PRAGMA user_version = 35;
    COMMIT;
  `);
  legacy.exec("PRAGMA foreign_keys = ON");
  const legacyEvaluationSchema = String(
    legacy
      .prepare(
        "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'evaluations'",
      )
      .get()?.sql,
  );
  assert.match(
    legacyEvaluationSchema,
    /cancellation_code = 'cancelled_by_operator'/,
  );
  assert.doesNotMatch(legacyEvaluationSchema, /cancelled_by_supersession/);
  assert.equal(
    legacy
      .prepare(
        `SELECT count(*) AS count FROM sqlite_schema
          WHERE type = 'table'
            AND name = 'github_automatic_evaluation_pull_requests'`,
      )
      .get()?.count,
    0,
  );
  legacy.close();

  const migrated = openDurableCore(databasePath);

  assert.equal(migrated.facts.schemaVersion, 38);
  assert.deepEqual(
    migrated.get(
      `SELECT evaluation_id, pull_request_number
         FROM github_automatic_evaluations`,
    ),
    { evaluation_id: "evaluation-1", pull_request_number: 17 },
  );
  assert.deepEqual(
    migrated.get(
      `SELECT evaluation_id, pull_request_number
         FROM github_automatic_evaluation_pull_requests`,
    ),
    { evaluation_id: "evaluation-1", pull_request_number: 17 },
  );
  migrated.run(
    `UPDATE evaluations
        SET execution_status = 'cancelled',
            cancellation_requested_at = 3,
            cancellation_code = ?,
            cancellation_detail = ?,
            completed_at = 3
      WHERE id = 'evaluation-1'`,
    SUPERSESSION.code,
    SUPERSESSION.detail,
  );
  assert.equal(
    migrated.get(
      "SELECT cancellation_code FROM evaluations WHERE id = 'evaluation-1'",
    )?.cancellation_code,
    SUPERSESSION.code,
  );
  migrated.close();
});
