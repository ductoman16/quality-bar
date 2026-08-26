export const CODEX_EXECUTION_PRE_START_SCHEMA = `
  CREATE TABLE IF NOT EXISTS codex_execution_pre_start_attempts (
    work_id TEXT NOT NULL,
    work_kind TEXT NOT NULL CHECK (
      work_kind IN ('review_run', 'waiver_adjudication')
    ),
    retry_cycle INTEGER NOT NULL CHECK (retry_cycle > 0),
    attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
    worker_id TEXT NOT NULL CHECK (length(worker_id) > 0),
    fencing_token INTEGER NOT NULL CHECK (fencing_token > 0),
    started_at INTEGER NOT NULL,
    PRIMARY KEY (work_id, retry_cycle, attempt_number)
  ) STRICT;
  CREATE TRIGGER IF NOT EXISTS codex_execution_pre_start_attempt_insert
    BEFORE INSERT ON codex_execution_pre_start_attempts
    WHEN NOT EXISTS (
      SELECT 1 FROM codex_execution_queue
      WHERE work_id = NEW.work_id
        AND work_kind = NEW.work_kind
        AND worker_id = NEW.worker_id
        AND fencing_token = NEW.fencing_token
        AND started_at IS NULL
        AND retry_state = 'ready'
        AND lease_expires_at > NEW.started_at
    )
    BEGIN
      SELECT RAISE(ABORT, 'codex_execution_pre_start_attempt_invalid');
    END;
  CREATE TRIGGER IF NOT EXISTS codex_execution_pre_start_attempt_immutable_update
    BEFORE UPDATE ON codex_execution_pre_start_attempts
    BEGIN
      SELECT RAISE(ABORT, 'codex_execution_pre_start_attempt_immutable');
    END;
  CREATE TRIGGER IF NOT EXISTS codex_execution_pre_start_attempt_immutable_delete
    BEFORE DELETE ON codex_execution_pre_start_attempts
    WHEN quality_bar_retention_cleanup() = 0
    BEGIN
      SELECT RAISE(ABORT, 'codex_execution_pre_start_attempt_immutable');
    END;
`;
