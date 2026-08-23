import * as retentionSchema from "../retention-schema.js";

export const WAIVER_ADJUDICATION_RECOVERY_SCHEMA = `
  ${retentionSchema.WAIVER_PRE_START_RETENTION_REBUILD}
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
  ${retentionSchema.WAIVER_PRE_START_SUMMARY_TRIGGER_SQL}
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
    WHEN quality_bar_retention_cleanup() = 0
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
  ${retentionSchema.WAIVER_PRE_START_RESET_TRIGGER_SQL}
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

export const WAIVER_ADJUDICATION_RECOVERY_BASELINE = `
  ALTER TABLE waiver_adjudications
    ADD COLUMN retry_cycle INTEGER NOT NULL DEFAULT 1
    CHECK (retry_cycle > 0);
  ${WAIVER_ADJUDICATION_RECOVERY_SCHEMA}
`;
