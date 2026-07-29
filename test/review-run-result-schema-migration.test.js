import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { createQueuedReviewRun } from "./review-run-claim-support.js";

test("schema v25 migrates queued Review Runs without inventing a partial Result", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-result-migrate-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const databasePath = join(directory, "quality-bar.sqlite3");
  const current = openDurableCore(databasePath);
  await createQueuedReviewRun(current);
  current.transaction((transaction) => {
    transaction.run("DROP TABLE criterion_results");
    transaction.run("DROP TRIGGER codex_execution_queue_identity_update");
    transaction.run("DROP TRIGGER codex_execution_queue_claim_insert");
    transaction.run("DROP TRIGGER codex_execution_queue_claim_update");
    transaction.run("DROP INDEX codex_execution_queue_ready");
    transaction.run("DROP INDEX codex_execution_queue_worker");
    transaction.run("DROP TABLE codex_execution_queue");
    transaction.run("DROP TRIGGER review_run_frozen_identity_update");
    transaction.run("DROP TRIGGER review_run_version_matches_review");
    transaction.run("ALTER TABLE review_runs RENAME TO review_runs_v26");
    transaction.run(
      `CREATE TABLE review_runs (
         id TEXT PRIMARY KEY,
         evaluation_id TEXT NOT NULL REFERENCES evaluations(id),
         review_id TEXT NOT NULL REFERENCES reviews(id),
         review_version_id TEXT NOT NULL REFERENCES review_versions(id),
         execution_status TEXT NOT NULL CHECK (
           execution_status IN ('queued', 'running', 'completed', 'failed', 'cancelled')
         ),
         created_at INTEGER NOT NULL,
         UNIQUE (evaluation_id, review_id)
       ) STRICT`,
    );
    transaction.run(
      `INSERT INTO review_runs (
         id, evaluation_id, review_id, review_version_id,
         execution_status, created_at
       )
       SELECT id, evaluation_id, review_id, review_version_id,
              execution_status, created_at
       FROM review_runs_v26`,
    );
    transaction.run("DROP TABLE review_runs_v26");
    transaction.run(
      `CREATE TABLE codex_execution_queue (
         work_id TEXT PRIMARY KEY REFERENCES review_runs(id),
         work_kind TEXT NOT NULL CHECK (work_kind = 'review_run'),
         ready_at INTEGER NOT NULL,
         accepted_at INTEGER NOT NULL,
         started_at INTEGER,
         worker_id TEXT CHECK (worker_id IS NULL OR length(worker_id) > 0),
         fencing_token INTEGER NOT NULL DEFAULT 0 CHECK (fencing_token >= 0),
         lease_expires_at INTEGER,
         CHECK (
           (worker_id IS NULL AND lease_expires_at IS NULL AND fencing_token = 0)
           OR
           (worker_id IS NOT NULL AND lease_expires_at IS NOT NULL AND fencing_token > 0)
         ),
         CHECK (started_at IS NULL OR started_at >= accepted_at)
       ) STRICT`,
    );
    transaction.run(
      `INSERT INTO codex_execution_queue (
         work_id, work_kind, ready_at, accepted_at, started_at
       ) VALUES ('review-run-1', 'review_run', 10, 10, NULL)`,
    );
    transaction.run(
      "UPDATE quality_bar_metadata SET value = '25' WHERE key = 'schema_version'",
    );
    transaction.run("PRAGMA user_version = 25");
  });
  current.close();

  const migrated = openDurableCore(databasePath);
  context.after(() => migrated.close());
  assert.equal(migrated.facts.schemaVersion, 26);
  assert.deepEqual(
    migrated.get(
      `SELECT execution_status, started_at, completed_at
       FROM review_runs WHERE id = 'review-run-1'`,
    ),
    { completed_at: null, execution_status: "queued", started_at: null },
  );
  assert.equal(
    migrated.get("SELECT count(*) AS count FROM criterion_results")?.count,
    0,
  );
  assert.equal(
    migrated.get("SELECT count(*) AS count FROM evaluation_results")?.count,
    0,
  );
});
