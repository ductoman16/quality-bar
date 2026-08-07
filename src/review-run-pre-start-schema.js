import { CODEX_EXECUTION_PRE_START_SCHEMA } from "./codex-execution-pre-start-schema.js";
import * as retentionSchema from "./retention-schema.js";

export const REVIEW_RUN_PRE_START_SCHEMA = `
  ${retentionSchema.REVIEW_RUN_PRE_START_RETENTION_REBUILD}
  ${CODEX_EXECUTION_PRE_START_SCHEMA}
  CREATE TABLE IF NOT EXISTS review_run_pre_start_attempts (
    review_run_id TEXT NOT NULL REFERENCES review_runs(id),
    retry_cycle INTEGER NOT NULL CHECK (retry_cycle > 0),
    attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
    failed_at INTEGER NOT NULL,
    error_code TEXT NOT NULL CHECK (
      length(error_code) > 0
      AND error_code NOT GLOB '*[^a-z0-9_]*'
      AND substr(error_code, 1, 1) GLOB '[a-z]'
    ),
    error_detail TEXT NOT NULL CHECK (length(trim(error_detail)) > 0),
    exhausted INTEGER NOT NULL CHECK (exhausted IN (0, 1)),
    PRIMARY KEY (review_run_id, retry_cycle, attempt_number)
  ) STRICT;
  CREATE TRIGGER IF NOT EXISTS review_run_pre_start_attempt_insert
    BEFORE INSERT ON review_run_pre_start_attempts
    WHEN NOT EXISTS (
      SELECT 1
      FROM review_runs
      JOIN codex_execution_queue
        ON codex_execution_queue.work_id = review_runs.id
       AND codex_execution_queue.work_kind = 'review_run'
      WHERE review_runs.id = NEW.review_run_id
        AND review_runs.execution_status = 'queued'
        AND review_runs.started_at IS NULL
        AND review_runs.retry_cycle = NEW.retry_cycle
        AND codex_execution_queue.started_at IS NULL
        AND codex_execution_queue.retry_state = 'ready'
        AND EXISTS (
          SELECT 1 FROM codex_execution_pre_start_attempts
          WHERE work_id = NEW.review_run_id
            AND work_kind = 'review_run'
            AND retry_cycle = NEW.retry_cycle
            AND attempt_number = NEW.attempt_number
            AND started_at <= NEW.failed_at
        )
    )
    BEGIN
      SELECT RAISE(ABORT, 'review_run_pre_start_attempt_invalid');
    END;
  ${retentionSchema.REVIEW_RUN_PRE_START_SUMMARY_TRIGGER_SQL}
  CREATE TRIGGER IF NOT EXISTS review_run_pre_start_attempt_exhaust
    AFTER INSERT ON review_run_pre_start_attempts
    WHEN NEW.exhausted = 1
    BEGIN
      UPDATE codex_execution_queue
      SET retry_state = 'exhausted'
      WHERE work_id = NEW.review_run_id AND work_kind = 'review_run';
    END;
  CREATE TRIGGER IF NOT EXISTS review_run_pre_start_attempt_immutable_update
    BEFORE UPDATE ON review_run_pre_start_attempts
    BEGIN
      SELECT RAISE(ABORT, 'review_run_pre_start_attempt_immutable');
    END;
  CREATE TRIGGER IF NOT EXISTS review_run_pre_start_attempt_immutable_delete
    BEFORE DELETE ON review_run_pre_start_attempts
    WHEN quality_bar_retention_cleanup() = 0
    BEGIN
      SELECT RAISE(ABORT, 'review_run_pre_start_attempt_immutable');
    END;
  CREATE TRIGGER IF NOT EXISTS review_run_retry_transition
    BEFORE UPDATE OF retry_state ON codex_execution_queue
    WHEN OLD.work_kind = 'review_run' AND NOT (
      (OLD.retry_state = 'ready' AND NEW.retry_state = 'exhausted'
        AND EXISTS (
          SELECT 1 FROM review_run_pre_start_attempts
          JOIN review_runs
            ON review_runs.id = review_run_pre_start_attempts.review_run_id
          WHERE review_runs.id = OLD.work_id
            AND review_run_pre_start_attempts.retry_cycle =
                review_runs.retry_cycle
            AND review_run_pre_start_attempts.exhausted = 1
        ))
      OR (OLD.retry_state = 'exhausted' AND NEW.retry_state = 'ready'
        AND NEW.started_at IS NULL
        AND EXISTS (
          SELECT 1 FROM review_runs
          WHERE review_runs.id = OLD.work_id
            AND review_runs.execution_status = 'queued'
            AND review_runs.started_at IS NULL
            AND review_runs.pre_start_cycle_attempt_count = 0
            AND review_runs.pre_start_cycle_retry_error_code IS NULL
            AND review_runs.pre_start_cycle_retry_error_detail IS NULL
            AND review_runs.pre_start_cycle_exhausted_at IS NULL
            AND review_runs.pre_start_exhausted_cycle IS NOT NULL
            AND review_runs.retry_cycle = review_runs.pre_start_exhausted_cycle + 1
        ))
      OR NEW.retry_state = OLD.retry_state
    )
    BEGIN
      SELECT RAISE(ABORT, 'review_run_retry_transition_invalid');
    END;
  CREATE TRIGGER IF NOT EXISTS review_run_retry_cycle_transition
    BEFORE UPDATE OF retry_cycle ON review_runs
    WHEN NOT (
      NEW.retry_cycle = OLD.retry_cycle
      OR (
        NEW.retry_cycle = OLD.retry_cycle + 1
        AND OLD.execution_status = 'queued'
        AND OLD.started_at IS NULL
        AND EXISTS (
          SELECT 1 FROM codex_execution_queue
          WHERE work_id = OLD.id AND work_kind = 'review_run'
            AND started_at IS NULL AND retry_state = 'exhausted'
        )
        AND OLD.pre_start_cycle_exhausted_at IS NOT NULL
        AND OLD.pre_start_exhausted_cycle = OLD.retry_cycle
        AND NEW.pre_start_cycle_attempt_count = 0
        AND NEW.pre_start_cycle_retry_error_code IS NULL
        AND NEW.pre_start_cycle_retry_error_detail IS NULL
        AND NEW.pre_start_cycle_exhausted_at IS NULL
      )
    )
    BEGIN
      SELECT RAISE(ABORT, 'review_run_retry_cycle_transition_invalid');
    END;
  ${retentionSchema.REVIEW_RUN_PRE_START_RESET_TRIGGER_SQL}
  CREATE TRIGGER IF NOT EXISTS review_run_exhausted_start
    BEFORE UPDATE OF started_at ON codex_execution_queue
    WHEN OLD.work_kind = 'review_run'
      AND OLD.retry_state = 'exhausted'
      AND NEW.started_at IS NOT NULL
    BEGIN
      SELECT RAISE(ABORT, 'review_run_retry_exhausted');
    END;
  CREATE TABLE IF NOT EXISTS evaluation_pre_start_retries (
    route TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    evaluation_id TEXT NOT NULL REFERENCES evaluations(id),
    response_status INTEGER NOT NULL CHECK (response_status = 200),
    response_body TEXT NOT NULL CHECK (json_valid(response_body)),
    created_at INTEGER NOT NULL,
    PRIMARY KEY (route, idempotency_key)
  ) STRICT;
  CREATE TRIGGER IF NOT EXISTS evaluation_pre_start_retry_immutable_update BEFORE UPDATE ON evaluation_pre_start_retries BEGIN SELECT RAISE(ABORT, 'evaluation_pre_start_retry_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS evaluation_pre_start_retry_immutable_delete BEFORE DELETE ON evaluation_pre_start_retries BEGIN SELECT RAISE(ABORT, 'evaluation_pre_start_retry_immutable'); END;
`;

export const REVIEW_RUN_PRE_START_MIGRATION = `ALTER TABLE review_runs ADD COLUMN retry_cycle INTEGER NOT NULL DEFAULT 1 CHECK (retry_cycle > 0); ${REVIEW_RUN_PRE_START_SCHEMA}`;

const OBJECTS = {
  codex_execution_pre_start_attempt_insert: {
    signatures: [
      "before insert on codex_execution_pre_start_attempts",
      "fencing_token = new.fencing_token",
      "raise(abort, 'codex_execution_pre_start_attempt_invalid')",
    ],
    type: "trigger",
  },
  codex_execution_pre_start_attempt_immutable_delete: {
    signatures: [
      "before delete on codex_execution_pre_start_attempts",
      "when quality_bar_retention_cleanup() = 0",
      "raise(abort, 'codex_execution_pre_start_attempt_immutable')",
    ],
    type: "trigger",
  },
  codex_execution_pre_start_attempt_immutable_update: {
    signatures: [
      "before update on codex_execution_pre_start_attempts",
      "raise(abort, 'codex_execution_pre_start_attempt_immutable')",
    ],
    type: "trigger",
  },
  codex_execution_pre_start_attempts: {
    signatures: [
      "work_id text not null",
      "check (retry_cycle > 0)",
      "check (attempt_number > 0)",
      "primary key (work_id, retry_cycle, attempt_number)",
      "strict",
    ],
    type: "table",
  },
  evaluation_pre_start_retries: {
    signatures: [
      "evaluation_id text not null references evaluations(id)",
      "response_status integer not null check (response_status = 200)",
      "response_body text not null check (json_valid(response_body))",
      "primary key (route, idempotency_key)",
      "strict",
    ],
    type: "table",
  },
  evaluation_pre_start_retry_immutable_delete: {
    signatures: [
      "before delete on evaluation_pre_start_retries",
      "raise(abort, 'evaluation_pre_start_retry_immutable')",
    ],
    type: "trigger",
  },
  evaluation_pre_start_retry_immutable_update: {
    signatures: [
      "before update on evaluation_pre_start_retries",
      "raise(abort, 'evaluation_pre_start_retry_immutable')",
    ],
    type: "trigger",
  },
  review_run_exhausted_start: {
    signatures: [
      "before update of started_at on codex_execution_queue",
      "old.retry_state = 'exhausted'",
      "raise(abort, 'review_run_retry_exhausted')",
    ],
    type: "trigger",
  },
  review_run_pre_start_attempt_exhaust: {
    signatures: [
      "after insert on review_run_pre_start_attempts",
      "when new.exhausted = 1",
      "set retry_state = 'exhausted'",
    ],
    type: "trigger",
  },
  review_run_pre_start_attempt_immutable_delete: {
    signatures: [
      "before delete on review_run_pre_start_attempts",
      "when quality_bar_retention_cleanup() = 0",
      "raise(abort, 'review_run_pre_start_attempt_immutable')",
    ],
    type: "trigger",
  },
  review_run_pre_start_attempt_immutable_update: {
    signatures: [
      "before update on review_run_pre_start_attempts",
      "raise(abort, 'review_run_pre_start_attempt_immutable')",
    ],
    type: "trigger",
  },
  review_run_pre_start_attempt_insert: {
    signatures: [
      "before insert on review_run_pre_start_attempts",
      "execution_status = 'queued'",
      "retry_cycle = new.retry_cycle",
      "raise(abort, 'review_run_pre_start_attempt_invalid')",
    ],
    type: "trigger",
  },
  review_run_pre_start_attempts: {
    signatures: [
      "references review_runs(id)",
      "check (retry_cycle > 0)",
      "check (attempt_number > 0)",
      "check (exhausted in (0, 1))",
      "primary key (review_run_id, retry_cycle, attempt_number)",
      "strict",
    ],
    type: "table",
  },
  review_run_retry_transition: {
    signatures: [
      "before update of retry_state on codex_execution_queue",
      "old.work_kind = 'review_run'",
      "raise(abort, 'review_run_retry_transition_invalid')",
    ],
    type: "trigger",
  },
  review_run_retry_cycle_transition: {
    signatures: [
      "before update of retry_cycle on review_runs",
      "new.retry_cycle = old.retry_cycle + 1",
      "retry_state = 'exhausted'",
      "raise(abort, 'review_run_retry_cycle_transition_invalid')",
    ],
    type: "trigger",
  },
};

const TABLE_COLUMNS = {
  codex_execution_pre_start_attempts: [
    ["work_id", "TEXT", 1, null, 1],
    ["work_kind", "TEXT", 1, null, 0],
    ["retry_cycle", "INTEGER", 1, null, 2],
    ["attempt_number", "INTEGER", 1, null, 3],
    ["worker_id", "TEXT", 1, null, 0],
    ["fencing_token", "INTEGER", 1, null, 0],
    ["started_at", "INTEGER", 1, null, 0],
  ],
  evaluation_pre_start_retries: [
    ["route", "TEXT", 1, null, 1],
    ["idempotency_key", "TEXT", 1, null, 2],
    ["request_hash", "TEXT", 1, null, 0],
    ["evaluation_id", "TEXT", 1, null, 0],
    ["response_status", "INTEGER", 1, null, 0],
    ["response_body", "TEXT", 1, null, 0],
    ["created_at", "INTEGER", 1, null, 0],
  ],
  review_run_pre_start_attempts: [
    ["review_run_id", "TEXT", 1, null, 1],
    ["retry_cycle", "INTEGER", 1, null, 2],
    ["attempt_number", "INTEGER", 1, null, 3],
    ["failed_at", "INTEGER", 1, null, 0],
    ["error_code", "TEXT", 1, null, 0],
    ["error_detail", "TEXT", 1, null, 0],
    ["exhausted", "INTEGER", 1, null, 0],
  ],
};

/** @param {unknown} value */
const normalizeSql = (value) =>
  typeof value === "string"
    ? value.replaceAll(/\s+/g, " ").trim().toLowerCase()
    : "";

/**
 * @param {import("node:sqlite").DatabaseSync} database
 * @param {keyof typeof TABLE_COLUMNS} table
 */
function tableShapeMatches(database, table) {
  const actual = database
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map(({ name, type, notnull, dflt_value: defaultValue, pk }) => [
      name,
      type,
      notnull,
      defaultValue,
      pk,
    ]);
  return JSON.stringify(actual) === JSON.stringify(TABLE_COLUMNS[table]);
}

/**
 * @param {import("node:sqlite").DatabaseSync} database
 * @param {string} [pendingStatements]
 */
export function reviewRunPreStartMigration(database, pendingStatements = "") {
  const reviewRunsSchema = normalizeSql(
    database
      .prepare(
        "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'review_runs'",
      )
      .get()?.sql,
  );
  const retryCycle = database
    .prepare("PRAGMA table_info(review_runs)")
    .all()
    .find(({ name }) => name === "retry_cycle");
  const objects = database
    .prepare(
      `SELECT name, type, sql FROM sqlite_schema
       WHERE name LIKE 'codex_execution_pre_start_attempt%'
          OR name LIKE 'review_run_pre_start_attempt%'
          OR name LIKE 'evaluation_pre_start_retr%'
          OR name LIKE 'review_run_retry_%'
          OR name = 'review_run_exhausted_start'`,
    )
    .all();
  const summarySql = new Map(
    objects.map(({ name, sql }) => [name, normalizeSql(sql)]),
  );
  const summaryObjectsComplete =
    summarySql
      .get("review_run_pre_start_attempt_summary")
      ?.includes("pre_start_attempt_count = pre_start_attempt_count + 1") &&
    summarySql
      .get("review_run_retry_cycle_summary_reset")
      ?.includes("pre_start_cycle_attempt_count = 0");
  const retentionRepairRequired =
    !retentionSchema.hasRetentionSchema(database) || !summaryObjectsComplete;
  const retryCycleComplete =
    retryCycle?.type === "INTEGER" &&
    retryCycle.notnull === 1 &&
    retryCycle.dflt_value === "1" &&
    reviewRunsSchema.includes(
      "retry_cycle integer not null default 1 check (retry_cycle > 0)",
    );
  const objectsComplete = Object.entries(OBJECTS).every(([name, expected]) => {
    const object = objects.find((candidate) => candidate.name === name);
    const sql = normalizeSql(object?.sql);
    return (
      object?.type === expected.type &&
      expected.signatures.every((signature) =>
        sql.includes(normalizeSql(signature)),
      ) &&
      (expected.type !== "table" ||
        tableShapeMatches(
          database,
          /** @type {keyof typeof TABLE_COLUMNS} */ (name),
        ))
    );
  });
  if (retryCycleComplete && objectsComplete && retentionRepairRequired) {
    return REVIEW_RUN_PRE_START_SCHEMA;
  }
  if (retryCycleComplete && objectsComplete) {
    return "";
  }
  if (objects.length === 0) {
    if (!reviewRunsSchema || retryCycleComplete) {
      return REVIEW_RUN_PRE_START_SCHEMA;
    }
    if (!retryCycle) {
      return pendingStatements.includes(
        "retry_cycle INTEGER NOT NULL DEFAULT 1",
      )
        ? REVIEW_RUN_PRE_START_SCHEMA
        : REVIEW_RUN_PRE_START_MIGRATION;
    }
  }
  throw Object.assign(
    new Error("Review Run pre-start retry schema is incomplete"),
    {
      code: "schema_invalid",
    },
  );
}
