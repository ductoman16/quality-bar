import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { createReviewRunClaimService } from "../src/review-run-claim.js";
import {
  createQueuedReviewRun,
  createSiblingQueuedReviewRun,
} from "./review-run-claim-support.js";

test("schema v24 migrates queued Review Runs to unclaimed fence zero", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-claim-migrate-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const databasePath = join(directory, "quality-bar.sqlite3");
  const current = openDurableCore(databasePath);
  await createQueuedReviewRun(current);
  current.transaction((transaction) => {
    transaction.run(
      "DROP TRIGGER waiver_adjudication_request_set_frozen_insert",
    );
    transaction.run("DROP TRIGGER waiver_adjudication_request_seal_update");
    transaction.run("DROP TRIGGER codex_execution_queue_identity_update");
    transaction.run("DROP TRIGGER codex_execution_queue_claim_update");
    transaction.run("DROP INDEX codex_execution_queue_ready");
    transaction.run("DROP INDEX codex_execution_queue_worker");
    transaction.run(
      "ALTER TABLE codex_execution_queue RENAME TO codex_execution_queue_v25",
    );
    transaction.run(
      `CREATE TABLE codex_execution_queue (
         work_id TEXT PRIMARY KEY REFERENCES review_runs(id),
         work_kind TEXT NOT NULL CHECK (work_kind = 'review_run'),
         ready_at INTEGER NOT NULL,
         accepted_at INTEGER NOT NULL,
         started_at INTEGER,
         CHECK (started_at IS NULL OR started_at >= accepted_at)
       ) STRICT`,
    );
    transaction.run(
      `INSERT INTO codex_execution_queue (
         work_id, work_kind, ready_at, accepted_at, started_at
       )
       SELECT work_id, work_kind, ready_at, accepted_at, started_at
       FROM codex_execution_queue_v25`,
    );
    transaction.run("DROP TABLE codex_execution_queue_v25");
    transaction.run(
      "UPDATE quality_bar_metadata SET value = '24' WHERE key = 'schema_version'",
    );
    transaction.run("PRAGMA user_version = 24");
  });
  current.close();

  const migrated = openDurableCore(databasePath);
  context.after(() => migrated.close());
  assert.equal(migrated.facts.schemaVersion, 38);
  assert.deepEqual(
    migrated.get(
      `SELECT worker_id, fencing_token, lease_expires_at
       FROM codex_execution_queue WHERE work_id = ?`,
      "review-run-1",
    ),
    { fencing_token: 0, lease_expires_at: null, worker_id: null },
  );
  assert.deepEqual(
    migrated.all(
      `SELECT name, type FROM sqlite_schema
       WHERE name IN (
         'codex_execution_queue_claim_insert',
         'codex_execution_queue_claim_update',
         'codex_execution_queue_worker'
       )
       ORDER BY name`,
    ),
    [
      { name: "codex_execution_queue_claim_insert", type: "trigger" },
      { name: "codex_execution_queue_claim_update", type: "trigger" },
      { name: "codex_execution_queue_worker", type: "index" },
    ],
  );
  assert.throws(
    () =>
      migrated.run(
        `UPDATE codex_execution_queue
         SET worker_id = ?, fencing_token = 0, lease_expires_at = ?
         WHERE work_id = ?`,
        "invalid-worker",
        121_000,
        "review-run-1",
      ),
    /review_run_claim_invalid/,
  );
  createSiblingQueuedReviewRun(migrated);
  migrated.run(
    "DELETE FROM codex_execution_queue WHERE work_id = ?",
    "review-run-2",
  );
  assert.throws(
    () =>
      migrated.run(
        `INSERT INTO codex_execution_queue (
           work_id,
           work_kind,
           ready_at,
           accepted_at,
           worker_id,
           fencing_token,
           lease_expires_at
         ) VALUES (?, 'review_run', ?, ?, ?, 0, NULL)`,
        "review-run-2",
        20,
        20,
        "invalid-worker",
      ),
    /review_run_claim_invalid/,
  );
  migrated.run(
    `INSERT INTO codex_execution_queue (
       work_id, work_kind, ready_at, accepted_at
     ) VALUES (?, 'review_run', ?, ?)`,
    "review-run-2",
    20,
    20,
  );
  const migratedClaims = createReviewRunClaimService(migrated, {
    createWorkerId: () => "worker-after-migration",
    now: () => 1_000,
  });
  assert.equal(migratedClaims.claimNext()?.fencingToken, 1);
  assert.throws(
    () => migratedClaims.claimNext(),
    /UNIQUE constraint failed: codex_execution_queue.worker_id/,
  );
});
