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
      DROP TRIGGER waiver_adjudication_exhausted_start;
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
