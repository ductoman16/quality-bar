import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";

/** @param {string} retryStateDefinition */
function assertMalformedRetryStateRejected(retryStateDefinition) {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-waiver-v43-retry-state-"),
  );
  const databasePath = join(directory, "quality-bar.sqlite");
  try {
    const current = openDurableCore(databasePath);
    current.close();
    const malformed = new DatabaseSync(databasePath);
    malformed.exec(`
      DROP TABLE waiver_recovery_idempotency;
      DROP TABLE waiver_adjudication_pre_start_attempts;
      DROP TRIGGER waiver_adjudication_retry_transition;
      DROP TRIGGER waiver_adjudication_retry_cycle_summary_reset;
      DROP TRIGGER waiver_adjudication_exhausted_start;
      DROP TRIGGER review_run_pre_start_attempt_insert;
      DROP TRIGGER review_run_pre_start_attempt_exhaust;
      DROP TRIGGER review_run_retry_cycle_transition;
      DROP TRIGGER review_run_retry_transition;
      DROP TRIGGER review_run_exhausted_start;
      DROP TABLE codex_execution_pre_start_attempts;
      ALTER TABLE waiver_adjudications DROP COLUMN retry_cycle;
      DROP INDEX codex_execution_queue_ready;
      ALTER TABLE codex_execution_queue DROP COLUMN retry_state;
      ALTER TABLE codex_execution_queue
        ADD COLUMN ${retryStateDefinition};
      UPDATE quality_bar_metadata
      SET value = '43' WHERE key = 'schema_version';
      PRAGMA user_version = 43;
    `);
    malformed.close();
    assert.throws(
      () => openDurableCore(databasePath),
      (error) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "schema_invalid",
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

test("canonical schema v43 rejects a malformed shared retry default", () => {
  assertMalformedRetryStateRejected(
    `retry_state TEXT NOT NULL DEFAULT 'broken'
     CHECK (retry_state IN ('ready', 'exhausted', 'broken'))`,
  );
});

test("canonical schema v43 rejects a widened shared retry constraint", () => {
  assertMalformedRetryStateRejected(
    `retry_state TEXT NOT NULL DEFAULT 'ready'
     CHECK (retry_state IN ('ready', 'exhausted', 'broken'))`,
  );
});

test("canonical schema v43 rejects a missing shared retry constraint", () => {
  assertMalformedRetryStateRejected(
    "retry_state TEXT NOT NULL DEFAULT 'ready'",
  );
});

test("schema v47 repairs waiver recovery before retention objects existed", () => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-waiver-v47-"));
  const databasePath = join(directory, "quality-bar.sqlite");
  try {
    const current = openDurableCore(databasePath);
    current.close();
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(`
      DROP TRIGGER waiver_adjudication_pre_start_attempt_summary;
      DROP TRIGGER waiver_adjudication_retry_cycle_summary_reset;
      DROP TRIGGER review_run_pre_start_attempt_summary;
      DROP TRIGGER review_run_retry_cycle_summary_reset;
      DROP INDEX application_logs_occurred_at;
      DROP TABLE application_logs;
      UPDATE quality_bar_metadata SET value = '47'
      WHERE key = 'schema_version';
      PRAGMA user_version = 47;
    `);
    legacy.close();

    const migrated = openDurableCore(databasePath);
    assert.equal(migrated.facts.schemaVersion, 51);
    assert.ok(
      migrated.get(
        `SELECT 1 FROM sqlite_schema
         WHERE type = 'trigger'
           AND name = 'waiver_adjudication_pre_start_attempt_summary'`,
      ),
    );
    assert.ok(
      migrated.get(
        `SELECT 1 FROM sqlite_schema
         WHERE type = 'trigger'
           AND name = 'waiver_adjudication_retry_cycle_summary_reset'`,
      ),
    );
    assert.ok(
      migrated.get(
        "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'application_logs'",
      ),
    );
    migrated.close();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
