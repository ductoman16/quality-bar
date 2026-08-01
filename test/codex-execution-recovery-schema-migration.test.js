import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { CODEX_EXECUTION_QUEUE_TRIGGERS } from "../src/codex-execution-queue-schema.js";
import { createCodexExecutionClaimService } from "../src/codex-execution-claim.js";
import { openDurableCore } from "../src/durable-core.js";
import {
  createReviewRunResultService,
  ReviewRunExecutionError,
} from "../src/review-run-result.js";
import { WAIVER_ADJUDICATION_RECOVERY_SCHEMA } from "../src/waiver-adjudication-recovery-schema.js";
import { REVIEW_RUN_PRE_START_SCHEMA } from "../src/review-run-pre-start-schema.js";
import { createQueuedReviewRun } from "./review-run-claim-support.js";

/** @param {string} databasePath */
function downgradeToVersion44(databasePath) {
  const deployed = new DatabaseSync(databasePath);
  deployed.exec(`
    PRAGMA foreign_keys = OFF;
    PRAGMA legacy_alter_table = ON;
    DROP TRIGGER IF EXISTS review_run_pre_start_attempt_insert;
    DROP TRIGGER IF EXISTS review_run_pre_start_attempt_exhaust;
    DROP TRIGGER IF EXISTS review_run_retry_transition;
    DROP TRIGGER IF EXISTS review_run_exhausted_start;
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
  deployed.exec(REVIEW_RUN_PRE_START_SCHEMA);
  deployed.exec(CODEX_EXECUTION_QUEUE_TRIGGERS);
  deployed.close();
}

test("schema v44 preserves queued work while adding restart process facts", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-recovery-v44-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const databasePath = join(directory, "quality-bar.sqlite");
  const current = openDurableCore(databasePath);
  await createQueuedReviewRun(current);
  current.close();
  downgradeToVersion44(databasePath);

  const migrated = openDurableCore(databasePath);
  context.after(() => migrated.close());
  assert.equal(migrated.facts.schemaVersion, 50);
  assert.deepEqual(
    migrated.get(
      `SELECT work_kind, started_at, process_group_id,
              process_group_recorded_at, process_boot_identity,
              process_namespace_identity, process_start_identity,
              process_group_finished_at,
              recovery_termination_signal, recovered_at
       FROM codex_execution_queue WHERE work_id = 'review-run-1'`,
    ),
    {
      process_group_finished_at: null,
      process_group_id: null,
      process_group_recorded_at: null,
      process_boot_identity: null,
      process_namespace_identity: null,
      process_start_identity: null,
      recovered_at: null,
      recovery_termination_signal: null,
      started_at: null,
      work_kind: "review_run",
    },
  );
  assert.throws(
    () =>
      migrated.run(
        `INSERT INTO codex_execution_queue (
           work_id, work_kind, ready_at, accepted_at, started_at,
           process_group_recorded_at
         ) VALUES ('invalid-recovery-row', 'review_run', 20, 20, NULL, 99)`,
      ),
    /codex_execution_recovery_integrity_invalid/,
  );
});

test("schema v44 rejects unresolved started ownership before migration commits", async (context) => {
  for (const terminal of [false, true]) {
    const directory = mkdtempSync(
      join(
        tmpdir(),
        terminal
          ? "quality-bar-recovery-v44-terminal-"
          : "quality-bar-recovery-v44-running-",
      ),
    );
    context.after(() => rmSync(directory, { force: true, recursive: true }));
    const databasePath = join(directory, "quality-bar.sqlite");
    const current = openDurableCore(databasePath);
    await createQueuedReviewRun(current);
    const claims = createCodexExecutionClaimService(current, {
      createWorkerId: () => "legacy-worker",
      now: () => 20,
    });
    const claim = claims.claimNext();
    assert.ok(claim);
    claims.start(claim, "0.145.0");
    if (terminal) {
      createReviewRunResultService(current, { now: () => 30 }).fail(
        claim,
        new ReviewRunExecutionError(
          "unexpected_execution_failure",
          "Legacy Review Run failed",
        ),
      );
    }
    current.close();
    downgradeToVersion44(databasePath);

    assert.throws(
      () => openDurableCore(databasePath),
      (error) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "codex_execution_process_identity_unavailable" &&
        error.message ===
          "Legacy started Codex execution process identity is unavailable",
    );
    const unchanged = new DatabaseSync(databasePath);
    assert.equal(
      unchanged.prepare("PRAGMA user_version").get()?.user_version,
      44,
    );
    assert.equal(
      unchanged
        .prepare("PRAGMA table_info(codex_execution_queue)")
        .all()
        .some((column) => column.name === "process_group_id"),
      false,
    );
    unchanged.close();
  }
});
