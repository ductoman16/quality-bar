import { CODEX_EXECUTION_PRE_START_SCHEMA } from "../codex/codex-execution-pre-start-schema.js";
import * as retentionSchema from "../retention-schema.js";

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
