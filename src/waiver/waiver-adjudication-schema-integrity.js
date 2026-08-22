export const WAIVER_ADJUDICATION_TERMINAL_INTEGRITY = `
  CREATE TRIGGER IF NOT EXISTS waiver_adjudication_terminal_immutable
    BEFORE UPDATE OF execution_status ON waiver_adjudications
    WHEN OLD.execution_status IN ('completed', 'failed', 'cancelled')
    BEGIN SELECT RAISE(ABORT, 'waiver_adjudication_terminal_immutable'); END;
`;

export const WAIVER_ADJUDICATION_EXECUTION_INTEGRITY = `
  CREATE TRIGGER IF NOT EXISTS waiver_adjudication_failure_integrity_insert
    BEFORE INSERT ON waiver_adjudications
    WHEN NOT (
      (
        NEW.execution_status = 'failed'
        AND NEW.error_code IS NOT NULL
        AND length(NEW.error_code) > 0
        AND NEW.error_code NOT GLOB '*[^a-z0-9_]*'
        AND substr(NEW.error_code, 1, 1) GLOB '[a-z]'
        AND NEW.error_detail IS NOT NULL
        AND length(trim(NEW.error_detail)) > 0
      )
      OR (
        NEW.execution_status <> 'failed'
        AND NEW.error_code IS NULL
        AND NEW.error_detail IS NULL
      )
    )
    BEGIN SELECT RAISE(ABORT, 'waiver_adjudication_failure_invalid'); END;
  CREATE TRIGGER IF NOT EXISTS waiver_adjudication_failure_integrity_update
    BEFORE UPDATE OF execution_status, error_code, error_detail
    ON waiver_adjudications
    WHEN NOT (
      (
        NEW.execution_status = 'failed'
        AND NEW.error_code IS NOT NULL
        AND length(NEW.error_code) > 0
        AND NEW.error_code NOT GLOB '*[^a-z0-9_]*'
        AND substr(NEW.error_code, 1, 1) GLOB '[a-z]'
        AND NEW.error_detail IS NOT NULL
        AND length(trim(NEW.error_detail)) > 0
      )
      OR (
        NEW.execution_status <> 'failed'
        AND NEW.error_code IS NULL
        AND NEW.error_detail IS NULL
      )
    )
    BEGIN SELECT RAISE(ABORT, 'waiver_adjudication_failure_invalid'); END;
  CREATE TRIGGER IF NOT EXISTS waiver_adjudication_cli_version_insert
    BEFORE INSERT ON waiver_adjudications
    WHEN NEW.codex_cli_version IS NOT NULL
      AND length(trim(NEW.codex_cli_version)) = 0
    BEGIN SELECT RAISE(ABORT, 'waiver_adjudication_cli_version_invalid'); END;
  CREATE TRIGGER IF NOT EXISTS waiver_adjudication_cli_version_immutable
    BEFORE UPDATE OF codex_cli_version ON waiver_adjudications
    WHEN OLD.codex_cli_version IS NOT NULL
      OR NEW.codex_cli_version IS NULL
      OR length(trim(NEW.codex_cli_version)) = 0
    BEGIN SELECT RAISE(ABORT, 'waiver_adjudication_cli_version_invalid'); END;
  CREATE TRIGGER IF NOT EXISTS waiver_adjudication_execution_evidence_insert
    BEFORE INSERT ON waiver_adjudications
    WHEN (
      NEW.execution_evidence_recorded = 0
      AND (
        NEW.process_exit_code IS NOT NULL
        OR NEW.process_signal IS NOT NULL
        OR NEW.input_tokens IS NOT NULL
        OR NEW.cached_input_tokens IS NOT NULL
        OR NEW.output_tokens IS NOT NULL
      )
    ) OR (
      NEW.execution_evidence_recorded = 1
      AND (
        (NEW.process_exit_code IS NOT NULL AND NEW.process_exit_code < 0)
        OR (NEW.process_signal IS NOT NULL AND length(NEW.process_signal) = 0)
        OR (
          NEW.process_exit_code IS NOT NULL
          AND NEW.process_signal IS NOT NULL
        )
        OR (NEW.input_tokens IS NOT NULL AND NEW.input_tokens < 0)
        OR (
          NEW.cached_input_tokens IS NOT NULL
          AND NEW.cached_input_tokens < 0
        )
        OR (NEW.output_tokens IS NOT NULL AND NEW.output_tokens < 0)
      )
    )
    BEGIN
      SELECT RAISE(ABORT, 'waiver_adjudication_execution_evidence_invalid');
    END;
  CREATE TRIGGER IF NOT EXISTS waiver_adjudication_execution_evidence_immutable
    BEFORE UPDATE OF
      process_exit_code,
      process_signal,
      input_tokens,
      cached_input_tokens,
      output_tokens,
      execution_evidence_recorded
    ON waiver_adjudications
    WHEN OLD.execution_evidence_recorded <> 0
      OR NEW.execution_evidence_recorded <> 1
      OR (NEW.process_exit_code IS NOT NULL AND NEW.process_exit_code < 0)
      OR (NEW.process_signal IS NOT NULL AND length(NEW.process_signal) = 0)
      OR (
        NEW.process_exit_code IS NOT NULL
        AND NEW.process_signal IS NOT NULL
      )
      OR (NEW.input_tokens IS NOT NULL AND NEW.input_tokens < 0)
      OR (
        NEW.cached_input_tokens IS NOT NULL
        AND NEW.cached_input_tokens < 0
      )
      OR (NEW.output_tokens IS NOT NULL AND NEW.output_tokens < 0)
    BEGIN
      SELECT RAISE(ABORT, 'waiver_adjudication_execution_evidence_invalid');
    END;
`;

/** @param {import("node:sqlite").DatabaseSync} database */
