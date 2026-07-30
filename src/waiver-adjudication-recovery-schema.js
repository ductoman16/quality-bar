export const WAIVER_ADJUDICATION_RECOVERY_SCHEMA = `
  CREATE TABLE IF NOT EXISTS waiver_adjudication_pre_start_attempts (
    waiver_adjudication_id TEXT NOT NULL
      REFERENCES waiver_adjudications(id),
    retry_cycle INTEGER NOT NULL CHECK (retry_cycle > 0),
    attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
    failed_at INTEGER NOT NULL,
    error_code TEXT NOT NULL
      CHECK (
        length(error_code) > 0
        AND error_code NOT GLOB '*[^a-z0-9_]*'
        AND substr(error_code, 1, 1) GLOB '[a-z]'
      ),
    error_detail TEXT NOT NULL CHECK (length(trim(error_detail)) > 0),
    exhausted INTEGER NOT NULL CHECK (exhausted IN (0, 1)),
    PRIMARY KEY (
      waiver_adjudication_id,
      retry_cycle,
      attempt_number
    )
  ) STRICT;
  CREATE TRIGGER IF NOT EXISTS waiver_adjudication_pre_start_attempt_insert
    BEFORE INSERT ON waiver_adjudication_pre_start_attempts
    WHEN NOT EXISTS (
      SELECT 1
      FROM waiver_adjudications
      JOIN codex_execution_queue
        ON codex_execution_queue.work_id = waiver_adjudications.id
       AND codex_execution_queue.work_kind = 'waiver_adjudication'
      WHERE waiver_adjudications.id = NEW.waiver_adjudication_id
        AND waiver_adjudications.execution_status = 'queued'
        AND waiver_adjudications.started_at IS NULL
        AND waiver_adjudications.retry_cycle = NEW.retry_cycle
        AND codex_execution_queue.started_at IS NULL
        AND codex_execution_queue.retry_state = 'ready'
    )
    BEGIN
      SELECT RAISE(ABORT, 'waiver_adjudication_pre_start_attempt_invalid');
    END;
  CREATE TRIGGER IF NOT EXISTS waiver_adjudication_pre_start_attempt_exhaust
    AFTER INSERT ON waiver_adjudication_pre_start_attempts
    WHEN NEW.exhausted = 1
    BEGIN
      UPDATE codex_execution_queue
      SET retry_state = 'exhausted'
      WHERE work_id = NEW.waiver_adjudication_id
        AND work_kind = 'waiver_adjudication';
    END;
  CREATE TRIGGER IF NOT EXISTS waiver_adjudication_pre_start_attempt_immutable_update
    BEFORE UPDATE ON waiver_adjudication_pre_start_attempts
    BEGIN
      SELECT RAISE(ABORT, 'waiver_adjudication_pre_start_attempt_immutable');
    END;
  CREATE TRIGGER IF NOT EXISTS waiver_adjudication_pre_start_attempt_immutable_delete
    BEFORE DELETE ON waiver_adjudication_pre_start_attempts
    BEGIN
      SELECT RAISE(ABORT, 'waiver_adjudication_pre_start_attempt_immutable');
    END;
  CREATE TRIGGER IF NOT EXISTS waiver_adjudication_retry_transition
    BEFORE UPDATE OF retry_state ON codex_execution_queue
    WHEN OLD.work_kind = 'waiver_adjudication' AND NOT (
      (
        OLD.retry_state = 'ready'
        AND NEW.retry_state = 'exhausted'
      )
      OR
      (
        OLD.retry_state = 'exhausted'
        AND NEW.retry_state = 'ready'
      )
      OR
      NEW.retry_state = OLD.retry_state
    )
    BEGIN
      SELECT RAISE(ABORT, 'waiver_adjudication_retry_transition_invalid');
    END;
  CREATE TRIGGER IF NOT EXISTS waiver_adjudication_exhausted_start
    BEFORE UPDATE OF started_at ON codex_execution_queue
    WHEN OLD.work_kind = 'waiver_adjudication'
      AND OLD.retry_state = 'exhausted'
      AND NEW.started_at IS NOT NULL
    BEGIN
      SELECT RAISE(ABORT, 'waiver_adjudication_retry_exhausted');
    END;
  CREATE TABLE IF NOT EXISTS waiver_recovery_idempotency (
    route TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    response_status INTEGER NOT NULL CHECK (response_status IN (200, 201)),
    response_body TEXT NOT NULL,
    source_adjudication_id TEXT NOT NULL
      REFERENCES waiver_adjudications(id),
    recovered_adjudication_id TEXT NOT NULL
      REFERENCES waiver_adjudications(id),
    created_at INTEGER NOT NULL,
    PRIMARY KEY (route, idempotency_key)
  ) STRICT;
  CREATE TRIGGER IF NOT EXISTS waiver_recovery_idempotency_immutable_update
    BEFORE UPDATE ON waiver_recovery_idempotency
    BEGIN SELECT RAISE(ABORT, 'waiver_recovery_idempotency_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS waiver_recovery_idempotency_immutable_delete
    BEFORE DELETE ON waiver_recovery_idempotency
    BEGIN SELECT RAISE(ABORT, 'waiver_recovery_idempotency_immutable'); END;
`;

export const WAIVER_ADJUDICATION_RECOVERY_MIGRATION = `
  ALTER TABLE waiver_adjudications
    ADD COLUMN retry_cycle INTEGER NOT NULL DEFAULT 1
    CHECK (retry_cycle > 0);
  ${WAIVER_ADJUDICATION_RECOVERY_SCHEMA}
`;

const RECOVERY_OBJECTS = {
  waiver_adjudication_exhausted_start: {
    signatures: [
      "before update of started_at on codex_execution_queue",
      "old.retry_state = 'exhausted'",
      "raise(abort, 'waiver_adjudication_retry_exhausted')",
    ],
    type: "trigger",
  },
  waiver_adjudication_pre_start_attempt_exhaust: {
    signatures: [
      "after insert on waiver_adjudication_pre_start_attempts",
      "when new.exhausted = 1",
      "update codex_execution_queue",
      "set retry_state = 'exhausted'",
    ],
    type: "trigger",
  },
  waiver_adjudication_pre_start_attempt_immutable_delete: {
    signatures: [
      "before delete on waiver_adjudication_pre_start_attempts",
      "raise(abort, 'waiver_adjudication_pre_start_attempt_immutable')",
    ],
    type: "trigger",
  },
  waiver_adjudication_pre_start_attempt_immutable_update: {
    signatures: [
      "before update on waiver_adjudication_pre_start_attempts",
      "raise(abort, 'waiver_adjudication_pre_start_attempt_immutable')",
    ],
    type: "trigger",
  },
  waiver_adjudication_pre_start_attempt_insert: {
    signatures: [
      "before insert on waiver_adjudication_pre_start_attempts",
      "execution_status = 'queued'",
      "retry_cycle = new.retry_cycle",
      "raise(abort, 'waiver_adjudication_pre_start_attempt_invalid')",
    ],
    type: "trigger",
  },
  waiver_adjudication_pre_start_attempts: {
    signatures: [
      "check (retry_cycle > 0)",
      "check (attempt_number > 0)",
      "check (exhausted in (0, 1))",
      "references waiver_adjudications(id)",
      "primary key ( waiver_adjudication_id, retry_cycle, attempt_number )",
      "strict",
    ],
    type: "table",
  },
  waiver_adjudication_retry_transition: {
    signatures: [
      "before update of retry_state on codex_execution_queue",
      "old.work_kind = 'waiver_adjudication'",
      "raise(abort, 'waiver_adjudication_retry_transition_invalid')",
    ],
    type: "trigger",
  },
  waiver_recovery_idempotency: {
    signatures: [
      "check (response_status in (200, 201))",
      "source_adjudication_id text not null references waiver_adjudications(id)",
      "recovered_adjudication_id text not null references waiver_adjudications(id)",
      "primary key (route, idempotency_key)",
      "strict",
    ],
    type: "table",
  },
  waiver_recovery_idempotency_immutable_delete: {
    signatures: [
      "before delete on waiver_recovery_idempotency",
      "raise(abort, 'waiver_recovery_idempotency_immutable')",
    ],
    type: "trigger",
  },
  waiver_recovery_idempotency_immutable_update: {
    signatures: [
      "before update on waiver_recovery_idempotency",
      "raise(abort, 'waiver_recovery_idempotency_immutable')",
    ],
    type: "trigger",
  },
};

const RECOVERY_TABLE_COLUMNS = {
  waiver_adjudication_pre_start_attempts: [
    ["waiver_adjudication_id", "TEXT", 1, null, 1],
    ["retry_cycle", "INTEGER", 1, null, 2],
    ["attempt_number", "INTEGER", 1, null, 3],
    ["failed_at", "INTEGER", 1, null, 0],
    ["error_code", "TEXT", 1, null, 0],
    ["error_detail", "TEXT", 1, null, 0],
    ["exhausted", "INTEGER", 1, null, 0],
  ],
  waiver_recovery_idempotency: [
    ["route", "TEXT", 1, null, 1],
    ["idempotency_key", "TEXT", 1, null, 2],
    ["request_hash", "TEXT", 1, null, 0],
    ["response_status", "INTEGER", 1, null, 0],
    ["response_body", "TEXT", 1, null, 0],
    ["source_adjudication_id", "TEXT", 1, null, 0],
    ["recovered_adjudication_id", "TEXT", 1, null, 0],
    ["created_at", "INTEGER", 1, null, 0],
  ],
};

/** @param {unknown} value */
const normalizeSql = (value) =>
  typeof value === "string"
    ? value.replaceAll(/\s+/g, " ").trim().toLowerCase()
    : "";

/**
 * @param {import("node:sqlite").DatabaseSync} database
 * @param {"waiver_adjudication_pre_start_attempts" | "waiver_recovery_idempotency"} table
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
  return (
    JSON.stringify(actual) === JSON.stringify(RECOVERY_TABLE_COLUMNS[table])
  );
}

/** @param {import("node:sqlite").DatabaseSync} database */
export function waiverAdjudicationRecoveryMigration(database) {
  const storedSchemaVersion = Number(
    database
      .prepare(
        "SELECT value FROM quality_bar_metadata WHERE key = 'schema_version'",
      )
      .get()?.value,
  );
  const columns = database
    .prepare("PRAGMA table_info(waiver_adjudications)")
    .all();
  const retryCycle = columns.find(({ name }) => name === "retry_cycle");
  const queueColumns = database
    .prepare("PRAGMA table_info(codex_execution_queue)")
    .all();
  const queueRetryState = queueColumns.find(
    ({ name }) => name === "retry_state",
  );
  const queueSchema = normalizeSql(
    database
      .prepare(
        "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'codex_execution_queue'",
      )
      .get()?.sql,
  );
  const objects = database
    .prepare(
      `SELECT name, type, sql FROM sqlite_schema
         WHERE name LIKE 'waiver_adjudication_pre_start_attempt%'
            OR name LIKE 'waiver_adjudication_retry_%'
            OR name = 'waiver_adjudication_exhausted_start'
            OR name LIKE 'waiver_recovery_idempotency%'`,
    )
    .all();
  const hasCompleteQueueRetryState =
    queueRetryState?.type === "TEXT" &&
    queueRetryState.notnull === 1 &&
    queueRetryState.dflt_value === "'ready'" &&
    queueSchema.includes("check (retry_state in ('ready', 'exhausted'))");
  const hasCompleteColumns =
    retryCycle?.type === "INTEGER" &&
    retryCycle.notnull === 1 &&
    retryCycle.dflt_value === "1" &&
    hasCompleteQueueRetryState;
  const hasCompleteObjects = Object.entries(RECOVERY_OBJECTS).every(
    ([name, expected]) => {
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
            /** @type {keyof typeof RECOVERY_TABLE_COLUMNS} */ (name),
          ))
      );
    },
  );
  if (hasCompleteColumns && hasCompleteObjects) {
    return "";
  }
  if (
    !retryCycle &&
    objects.length === 0 &&
    (hasCompleteQueueRetryState ||
      (storedSchemaVersion < 43 && !queueRetryState))
  ) {
    return WAIVER_ADJUDICATION_RECOVERY_MIGRATION;
  }
  throw Object.assign(
    new Error("Waiver Adjudication recovery schema is incomplete"),
    { code: "schema_invalid" },
  );
}
