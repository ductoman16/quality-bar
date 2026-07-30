import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openDurableCore } from "../src/durable-core.js";

test("schema v45 migrates to durable Review Run pre-start retry without changing queued identity", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-v45-retry-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const databasePath = join(directory, "quality-bar.sqlite");
  openDurableCore(databasePath).close();

  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    DROP TRIGGER evaluation_pre_start_retry_immutable_delete;
    DROP TRIGGER evaluation_pre_start_retry_immutable_update;
    DROP TABLE evaluation_pre_start_retries;
    DROP TRIGGER review_run_exhausted_start;
    DROP TRIGGER review_run_retry_cycle_transition;
    DROP TRIGGER review_run_retry_transition;
    DROP TRIGGER review_run_pre_start_attempt_immutable_delete;
    DROP TRIGGER review_run_pre_start_attempt_immutable_update;
    DROP TRIGGER review_run_pre_start_attempt_exhaust;
    DROP TRIGGER review_run_pre_start_attempt_insert;
    DROP TABLE review_run_pre_start_attempts;
    DROP TRIGGER codex_execution_pre_start_attempt_immutable_delete;
    DROP TRIGGER codex_execution_pre_start_attempt_immutable_update;
    DROP TRIGGER codex_execution_pre_start_attempt_insert;
    DROP TABLE codex_execution_pre_start_attempts;
    ALTER TABLE review_runs DROP COLUMN retry_cycle;
    UPDATE quality_bar_metadata SET value = '45' WHERE key = 'schema_version';
    PRAGMA user_version = 45;
  `);
  legacy.close();

  const migrated = openDurableCore(databasePath);
  assert.equal(migrated.facts.schemaVersion, 47);
  const retryCycle = migrated
    .all("PRAGMA table_info(review_runs)")
    .find((row) => row?.name === "retry_cycle");
  assert.ok(retryCycle);
  assert.deepEqual(retryCycle, {
    cid: 17,
    dflt_value: "1",
    name: "retry_cycle",
    notnull: 1,
    pk: 0,
    type: "INTEGER",
  });
  assert.ok(
    migrated.get(
      "SELECT 1 AS present FROM sqlite_schema WHERE type = 'table' AND name = 'review_run_pre_start_attempts'",
    ),
  );
  migrated.close();
});

test("schema v46 rejects a malformed Evaluation retry authority table", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-v46-retry-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const databasePath = join(directory, "quality-bar.sqlite");
  openDurableCore(databasePath).close();

  const malformed = new DatabaseSync(databasePath);
  malformed.exec(`
    DROP TRIGGER evaluation_pre_start_retry_immutable_delete;
    DROP TRIGGER evaluation_pre_start_retry_immutable_update;
    DROP TABLE evaluation_pre_start_retries;
    CREATE TABLE evaluation_pre_start_retries (
      route TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      evaluation_id TEXT NOT NULL REFERENCES evaluations(id),
      created_at INTEGER NOT NULL
    ) STRICT;
    CREATE TRIGGER evaluation_pre_start_retry_immutable_update
      BEFORE UPDATE ON evaluation_pre_start_retries
      BEGIN SELECT RAISE(ABORT, 'evaluation_pre_start_retry_immutable'); END;
    CREATE TRIGGER evaluation_pre_start_retry_immutable_delete
      BEFORE DELETE ON evaluation_pre_start_retries
      BEGIN SELECT RAISE(ABORT, 'evaluation_pre_start_retry_immutable'); END;
    UPDATE quality_bar_metadata SET value = '45' WHERE key = 'schema_version';
    PRAGMA user_version = 45;
  `);
  malformed.close();

  assert.throws(
    () => openDurableCore(databasePath),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "schema_invalid",
  );
});

test("schema v46 gains terminal Waiver Adjudication immutability", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-v46-waiver-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const databasePath = join(directory, "quality-bar.sqlite");
  openDurableCore(databasePath).close();

  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    DROP TRIGGER waiver_adjudication_terminal_immutable;
    UPDATE quality_bar_metadata SET value = '46' WHERE key = 'schema_version';
    PRAGMA user_version = 46;
  `);
  legacy.close();

  const migrated = openDurableCore(databasePath);
  assert.equal(migrated.facts.schemaVersion, 47);
  assert.ok(
    migrated.get(
      "SELECT 1 AS present FROM sqlite_schema WHERE type = 'trigger' AND name = 'waiver_adjudication_terminal_immutable'",
    ),
  );
  migrated.close();
});
