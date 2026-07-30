import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { CODEX_EXECUTION_QUEUE_TRIGGERS } from "../src/codex-execution-queue-schema.js";
import { openDurableCore } from "../src/durable-core.js";
import { WAIVER_ADJUDICATION_RECOVERY_SCHEMA } from "../src/waiver-adjudication-recovery-schema.js";
import { createQueuedReviewRun } from "./review-run-claim-support.js";

test("schema v44 preserves queued work while adding restart process facts", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-recovery-v44-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const databasePath = join(directory, "quality-bar.sqlite");
  const current = openDurableCore(databasePath);
  await createQueuedReviewRun(current);
  current.close();
  const deployed = new DatabaseSync(databasePath);
  deployed.exec(`
    PRAGMA foreign_keys = OFF;
    PRAGMA legacy_alter_table = ON;
    BEGIN IMMEDIATE;
    ALTER TABLE codex_execution_queue RENAME TO codex_execution_queue_v44;
    CREATE TABLE codex_execution_queue (
      work_id TEXT PRIMARY KEY,
      work_kind TEXT NOT NULL
        CHECK (work_kind IN ('review_run', 'waiver_adjudication')),
      ready_at INTEGER NOT NULL,
      accepted_at INTEGER NOT NULL,
      started_at INTEGER,
      retry_state TEXT NOT NULL DEFAULT 'ready'
        CHECK (retry_state IN ('ready', 'exhausted')),
      worker_id TEXT CHECK (worker_id IS NULL OR length(worker_id) > 0),
      fencing_token INTEGER NOT NULL DEFAULT 0 CHECK (fencing_token >= 0),
      lease_expires_at INTEGER,
      CHECK (
        (worker_id IS NULL AND lease_expires_at IS NULL AND fencing_token = 0)
        OR
        (worker_id IS NOT NULL AND lease_expires_at IS NOT NULL
          AND fencing_token > 0)
      ),
      CHECK (started_at IS NULL OR started_at >= accepted_at)
    ) STRICT;
    INSERT INTO codex_execution_queue (
      work_id, work_kind, ready_at, accepted_at, started_at,
      retry_state, worker_id, fencing_token, lease_expires_at
    )
    SELECT
      work_id, work_kind, ready_at, accepted_at, started_at,
      retry_state, worker_id, fencing_token, lease_expires_at
    FROM codex_execution_queue_v44;
    DROP TABLE codex_execution_queue_v44;
    UPDATE quality_bar_metadata SET value = '44'
    WHERE key = 'schema_version';
    PRAGMA user_version = 44;
    COMMIT;
    PRAGMA legacy_alter_table = OFF;
    PRAGMA foreign_keys = ON;
  `);
  deployed.exec(`
    DROP TRIGGER IF EXISTS waiver_adjudication_pre_start_attempt_insert;
    DROP TRIGGER IF EXISTS waiver_adjudication_pre_start_attempt_exhaust;
    DROP TRIGGER IF EXISTS waiver_adjudication_retry_transition;
    DROP TRIGGER IF EXISTS waiver_adjudication_exhausted_start;
  `);
  deployed.exec(WAIVER_ADJUDICATION_RECOVERY_SCHEMA);
  deployed.exec(CODEX_EXECUTION_QUEUE_TRIGGERS);
  deployed.close();

  const migrated = openDurableCore(databasePath);
  context.after(() => migrated.close());
  assert.equal(migrated.facts.schemaVersion, 45);
  assert.deepEqual(
    migrated.get(
      `SELECT work_kind, started_at, process_group_id,
              process_group_recorded_at, process_group_finished_at,
              recovery_termination_signal, recovered_at
       FROM codex_execution_queue WHERE work_id = 'review-run-1'`,
    ),
    {
      process_group_finished_at: null,
      process_group_id: null,
      process_group_recorded_at: null,
      recovered_at: null,
      recovery_termination_signal: null,
      started_at: null,
      work_kind: "review_run",
    },
  );
});
