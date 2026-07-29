import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { waiverAdjudicationExecutionMigration } from "../src/waiver-adjudication-schema-migration.js";

test("schema v38 gains focused execution failure and evidence columns", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE waiver_adjudications (
      id TEXT PRIMARY KEY,
      evaluation_id TEXT NOT NULL,
      base_commit TEXT NOT NULL,
      head_commit TEXT NOT NULL,
      model TEXT NOT NULL,
      reasoning_effort TEXT NOT NULL,
      service_tier TEXT NOT NULL,
      execution_status TEXT NOT NULL,
      requests_sealed_at INTEGER,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER
    ) STRICT;
  `);
  database.exec(waiverAdjudicationExecutionMigration(database));
  assert.deepEqual(
    database
      .prepare("PRAGMA table_info(waiver_adjudications)")
      .all()
      .slice(-9)
      .map(({ name }) => name),
    [
      "error_code",
      "error_detail",
      "codex_cli_version",
      "process_exit_code",
      "process_signal",
      "input_tokens",
      "cached_input_tokens",
      "output_tokens",
      "execution_evidence_recorded",
    ],
  );
  assert.equal(waiverAdjudicationExecutionMigration(database), "");
  database
    .prepare(
      `INSERT INTO waiver_adjudications (
         id, evaluation_id, base_commit, head_commit, model, reasoning_effort,
         service_tier, execution_status, created_at
       ) VALUES ('adjudication-1', 'evaluation-1', 'base', 'head', 'model',
                 'high', 'standard', 'queued', 1)`,
    )
    .run();
  assert.throws(
    () =>
      database
        .prepare(
          "UPDATE waiver_adjudications SET execution_status = 'failed' WHERE id = 'adjudication-1'",
        )
        .run(),
    /waiver_adjudication_failure_invalid/,
  );
  assert.throws(
    () =>
      database
        .prepare(
          "UPDATE waiver_adjudications SET codex_cli_version = '' WHERE id = 'adjudication-1'",
        )
        .run(),
    /waiver_adjudication_cli_version_invalid/,
  );
  assert.throws(
    () =>
      database
        .prepare(
          `UPDATE waiver_adjudications
           SET process_exit_code = -1, execution_evidence_recorded = 1
           WHERE id = 'adjudication-1'`,
        )
        .run(),
    /waiver_adjudication_execution_evidence_invalid/,
  );
});

test("schema v38 fails migration rather than accepting an inexact failure", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE waiver_adjudications (
      id TEXT PRIMARY KEY,
      evaluation_id TEXT NOT NULL,
      base_commit TEXT NOT NULL,
      head_commit TEXT NOT NULL,
      model TEXT NOT NULL,
      reasoning_effort TEXT NOT NULL,
      service_tier TEXT NOT NULL,
      execution_status TEXT NOT NULL,
      requests_sealed_at INTEGER,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER
    ) STRICT;
    INSERT INTO waiver_adjudications (
      id, evaluation_id, base_commit, head_commit, model, reasoning_effort,
      service_tier, execution_status, created_at
    ) VALUES (
      'failed-adjudication', 'evaluation-1', 'base', 'head', 'model', 'high',
      'standard', 'failed', 1
    );
  `);
  assert.throws(
    () => database.exec(waiverAdjudicationExecutionMigration(database)),
    /waiver_adjudication_failure_invalid/,
  );
});
