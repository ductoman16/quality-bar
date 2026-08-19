export const RETENTION_SCHEMA = `
  CREATE TABLE IF NOT EXISTS application_logs (
    id TEXT PRIMARY KEY,
    occurred_at INTEGER NOT NULL CHECK (occurred_at >= 0),
    severity TEXT NOT NULL CHECK (length(trim(severity)) > 0),
    event TEXT NOT NULL CHECK (length(trim(event)) > 0),
    component TEXT NOT NULL CHECK (length(trim(component)) > 0),
    operation TEXT,
    attempt INTEGER CHECK (attempt IS NULL OR attempt >= 0),
    duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
    outcome TEXT NOT NULL CHECK (length(trim(outcome)) > 0),
    error_code TEXT,
    message TEXT NOT NULL CHECK (length(trim(message)) > 0),
    request_id TEXT,
    resource_ids TEXT,
    repository_id TEXT,
    changeset_id TEXT,
    evaluation_id TEXT,
    review_run_id TEXT,
    waiver_adjudication_id TEXT,
    delivery_source_id TEXT,
    application_version TEXT
  ) STRICT;
  CREATE INDEX IF NOT EXISTS application_logs_occurred_at
    ON application_logs (occurred_at ASC, id ASC);
`;

const RETENTION_TABLE_COLUMNS = Object.freeze([
  ["id", "TEXT", 1, 1],
  ["occurred_at", "INTEGER", 1, 0],
  ["severity", "TEXT", 1, 0],
  ["event", "TEXT", 1, 0],
  ["component", "TEXT", 1, 0],
  ["operation", "TEXT", 0, 0],
  ["attempt", "INTEGER", 0, 0],
  ["duration_ms", "INTEGER", 0, 0],
  ["outcome", "TEXT", 1, 0],
  ["error_code", "TEXT", 0, 0],
  ["message", "TEXT", 1, 0],
  ["request_id", "TEXT", 0, 0],
  ["resource_ids", "TEXT", 0, 0],
  ["repository_id", "TEXT", 0, 0],
  ["changeset_id", "TEXT", 0, 0],
  ["evaluation_id", "TEXT", 0, 0],
  ["review_run_id", "TEXT", 0, 0],
  ["waiver_adjudication_id", "TEXT", 0, 0],
  ["delivery_source_id", "TEXT", 0, 0],
  ["application_version", "TEXT", 0, 0],
]);

/** @param {import("node:sqlite").DatabaseSync} database */
function retentionTableShapeMatches(database) {
  const actual = database
    .prepare("PRAGMA table_info(application_logs)")
    .all()
    .map(({ name, type, notnull, pk }) => [name, type, notnull, pk]);
  const tableSql = database
    .prepare(
      "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'application_logs'",
    )
    .get()?.sql;
  return (
    JSON.stringify(actual) === JSON.stringify(RETENTION_TABLE_COLUMNS) &&
    typeof tableSql === "string" &&
    tableSql.toLowerCase().includes(") strict")
  );
}

/** @param {import("node:sqlite").DatabaseSync} database */
export function hasRetentionSchema(database) {
  if (
    !database
      .prepare(
        "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'application_logs'",
      )
      .get()
  ) {
    return false;
  }
  if (!retentionTableShapeMatches(database)) {
    throw Object.assign(
      new Error("Application log retention schema is malformed"),
      { code: "schema_invalid" },
    );
  }
  return true;
}

export const REVIEW_RUN_PRE_START_RETENTION_REBUILD = `
  DROP TRIGGER IF EXISTS codex_execution_pre_start_attempt_insert;
  DROP TRIGGER IF EXISTS codex_execution_pre_start_attempt_immutable_update;
  DROP TRIGGER IF EXISTS codex_execution_pre_start_attempt_immutable_delete;
  DROP TRIGGER IF EXISTS review_run_pre_start_attempt_insert;
  DROP TRIGGER IF EXISTS review_run_pre_start_attempt_summary;
  DROP TRIGGER IF EXISTS review_run_pre_start_attempt_exhaust;
  DROP TRIGGER IF EXISTS review_run_pre_start_attempt_immutable_update;
  DROP TRIGGER IF EXISTS review_run_pre_start_attempt_immutable_delete;
  DROP TRIGGER IF EXISTS review_run_retry_transition;
  DROP TRIGGER IF EXISTS review_run_retry_cycle_transition;
  DROP TRIGGER IF EXISTS review_run_retry_cycle_summary_reset;
  DROP TRIGGER IF EXISTS review_run_exhausted_start;
  DROP TRIGGER IF EXISTS evaluation_pre_start_retry_immutable_update;
  DROP TRIGGER IF EXISTS evaluation_pre_start_retry_immutable_delete;
`;

export const WAIVER_PRE_START_RETENTION_REBUILD = `
  DROP TRIGGER IF EXISTS waiver_adjudication_pre_start_attempt_insert;
  DROP TRIGGER IF EXISTS waiver_adjudication_pre_start_attempt_summary;
  DROP TRIGGER IF EXISTS waiver_adjudication_pre_start_attempt_exhaust;
  DROP TRIGGER IF EXISTS waiver_adjudication_pre_start_attempt_immutable_update;
  DROP TRIGGER IF EXISTS waiver_adjudication_pre_start_attempt_immutable_delete;
  DROP TRIGGER IF EXISTS waiver_adjudication_retry_transition;
  DROP TRIGGER IF EXISTS waiver_adjudication_retry_cycle_summary_reset;
  DROP TRIGGER IF EXISTS waiver_adjudication_exhausted_start;
  DROP TRIGGER IF EXISTS waiver_recovery_idempotency_immutable_update;
  DROP TRIGGER IF EXISTS waiver_recovery_idempotency_immutable_delete;
`;

export const RETRY_SUMMARY_COLUMNS_SQL = `
    pre_start_attempt_count INTEGER NOT NULL DEFAULT 0
      CHECK (pre_start_attempt_count >= 0),
    pre_start_cycle_attempt_count INTEGER NOT NULL DEFAULT 0
      CHECK (pre_start_cycle_attempt_count >= 0),
    pre_start_last_attempt_at INTEGER
      CHECK (pre_start_last_attempt_at IS NULL OR pre_start_last_attempt_at >= 0),
    pre_start_retry_error_code TEXT,
    pre_start_retry_error_detail TEXT,
    pre_start_cycle_retry_error_code TEXT,
    pre_start_cycle_retry_error_detail TEXT,
    pre_start_exhausted_at INTEGER
      CHECK (pre_start_exhausted_at IS NULL OR pre_start_exhausted_at >= 0),
    pre_start_cycle_exhausted_at INTEGER
      CHECK (pre_start_cycle_exhausted_at IS NULL OR pre_start_cycle_exhausted_at >= 0),
    pre_start_exhausted_cycle INTEGER
      CHECK (pre_start_exhausted_cycle IS NULL OR pre_start_exhausted_cycle > 0),`;

export const RETRY_SUMMARY_TRIGGERS_SQL = `
  CREATE TRIGGER IF NOT EXISTS RETRY_SUMMARY_TRIGGER_NAME
    AFTER INSERT ON RETRY_SUMMARY_ATTEMPT_TABLE
    BEGIN
      UPDATE RETRY_SUMMARY_OWNER_TABLE
      SET pre_start_attempt_count = pre_start_attempt_count + 1,
          pre_start_cycle_attempt_count = pre_start_cycle_attempt_count + 1,
          pre_start_last_attempt_at = NEW.failed_at,
          pre_start_retry_error_code = NEW.error_code,
          pre_start_retry_error_detail = NEW.error_detail,
          pre_start_cycle_retry_error_code = NEW.error_code,
          pre_start_cycle_retry_error_detail = NEW.error_detail,
          pre_start_exhausted_at = CASE
            WHEN NEW.exhausted = 1 THEN NEW.failed_at
            ELSE pre_start_exhausted_at
          END,
          pre_start_cycle_exhausted_at = CASE
            WHEN NEW.exhausted = 1 THEN NEW.failed_at
            ELSE NULL
          END,
          pre_start_exhausted_cycle = CASE
            WHEN NEW.exhausted = 1 THEN NEW.retry_cycle
            ELSE pre_start_exhausted_cycle
          END
      WHERE id = NEW.RETRY_SUMMARY_OWNER_ID;
    END;`;

export const RETRY_SUMMARY_RESET_TRIGGER_SQL = `
  CREATE TRIGGER IF NOT EXISTS RETRY_SUMMARY_RESET_TRIGGER_NAME
    AFTER UPDATE OF retry_cycle ON RETRY_SUMMARY_OWNER_TABLE
    WHEN NEW.retry_cycle <> OLD.retry_cycle
    BEGIN
      UPDATE RETRY_SUMMARY_OWNER_TABLE
      SET pre_start_cycle_attempt_count = 0,
          pre_start_cycle_retry_error_code = NULL,
          pre_start_cycle_retry_error_detail = NULL,
          pre_start_cycle_exhausted_at = NULL
      WHERE id = NEW.id;
    END;`;

/** @param {string} sql @param {Record<string, string>} replacements */
function specializeRetrySummarySql(sql, replacements) {
  return Object.entries(replacements).reduce(
    (result, [from, to]) => result.replaceAll(from, to),
    sql,
  );
}

export const REVIEW_RUN_PRE_START_SUMMARY_TRIGGER_SQL =
  specializeRetrySummarySql(RETRY_SUMMARY_TRIGGERS_SQL, {
    RETRY_SUMMARY_TRIGGER_NAME: "review_run_pre_start_attempt_summary",
    RETRY_SUMMARY_ATTEMPT_TABLE: "review_run_pre_start_attempts",
    RETRY_SUMMARY_OWNER_TABLE: "review_runs",
    RETRY_SUMMARY_OWNER_ID: "review_run_id",
  });
export const WAIVER_PRE_START_SUMMARY_TRIGGER_SQL = specializeRetrySummarySql(
  RETRY_SUMMARY_TRIGGERS_SQL,
  {
    RETRY_SUMMARY_TRIGGER_NAME: "waiver_adjudication_pre_start_attempt_summary",
    RETRY_SUMMARY_ATTEMPT_TABLE: "waiver_adjudication_pre_start_attempts",
    RETRY_SUMMARY_OWNER_TABLE: "waiver_adjudications",
    RETRY_SUMMARY_OWNER_ID: "waiver_adjudication_id",
  },
);
export const REVIEW_RUN_PRE_START_RESET_TRIGGER_SQL = specializeRetrySummarySql(
  RETRY_SUMMARY_RESET_TRIGGER_SQL,
  {
    RETRY_SUMMARY_RESET_TRIGGER_NAME: "review_run_retry_cycle_summary_reset",
    RETRY_SUMMARY_OWNER_TABLE: "review_runs",
  },
);
export const WAIVER_PRE_START_RESET_TRIGGER_SQL = specializeRetrySummarySql(
  RETRY_SUMMARY_RESET_TRIGGER_SQL,
  {
    RETRY_SUMMARY_RESET_TRIGGER_NAME:
      "waiver_adjudication_retry_cycle_summary_reset",
    RETRY_SUMMARY_OWNER_TABLE: "waiver_adjudications",
  },
);
