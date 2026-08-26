import { CODEX_EXECUTION_CONCURRENCY_SCHEMA } from "./codex-execution-concurrency-schema.ts";

export const CODEX_EXECUTION_QUEUE_TRIGGERS = `
  ${CODEX_EXECUTION_CONCURRENCY_SCHEMA}
  CREATE TRIGGER IF NOT EXISTS codex_execution_queue_identity_update
    BEFORE UPDATE OF work_id, work_kind, accepted_at
    ON codex_execution_queue
    BEGIN SELECT RAISE(ABORT, 'codex_execution_queue_identity_immutable'); END;
  CREATE TRIGGER IF NOT EXISTS codex_execution_queue_reference_insert
    BEFORE INSERT ON codex_execution_queue
    WHEN (
      (NEW.work_kind = 'review_run'
        AND NOT EXISTS (SELECT 1 FROM review_runs WHERE id = NEW.work_id))
      OR
      (NEW.work_kind = 'waiver_adjudication'
        AND NOT EXISTS (
          SELECT 1 FROM waiver_adjudications WHERE id = NEW.work_id
        ))
    )
    BEGIN SELECT RAISE(ABORT, 'codex_execution_queue_reference_invalid'); END;
  CREATE TRIGGER IF NOT EXISTS codex_execution_queue_waiver_requests_insert
    BEFORE INSERT ON codex_execution_queue
    WHEN NEW.work_kind = 'waiver_adjudication'
      AND NOT EXISTS (
        SELECT 1 FROM waiver_adjudication_requests
        WHERE waiver_adjudication_id = NEW.work_id
      )
    BEGIN
      SELECT RAISE(ABORT, 'waiver_adjudication_requests_required');
    END;
  CREATE TRIGGER IF NOT EXISTS codex_execution_queue_waiver_lifecycle_insert
    BEFORE INSERT ON codex_execution_queue
    WHEN NEW.work_kind = 'waiver_adjudication'
      AND NOT EXISTS (
        SELECT 1 FROM waiver_adjudications
        WHERE id = NEW.work_id
          AND execution_status = 'queued'
          AND requests_sealed_at IS NULL
          AND started_at IS NULL
          AND completed_at IS NULL
      )
    BEGIN
      SELECT RAISE(ABORT, 'waiver_adjudication_queue_lifecycle_invalid');
    END;
  CREATE TRIGGER IF NOT EXISTS codex_execution_queue_waiver_seal_insert
    AFTER INSERT ON codex_execution_queue
    WHEN NEW.work_kind = 'waiver_adjudication'
    BEGIN
      UPDATE waiver_adjudications
      SET requests_sealed_at = NEW.accepted_at
      WHERE id = NEW.work_id;
    END;
  CREATE TRIGGER IF NOT EXISTS codex_execution_queue_waiver_active_delete
    BEFORE DELETE ON codex_execution_queue
    WHEN OLD.work_kind = 'waiver_adjudication'
      AND EXISTS (
        SELECT 1 FROM waiver_adjudications
        WHERE id = OLD.work_id
          AND execution_status IN ('queued', 'running')
      )
    BEGIN
      SELECT RAISE(ABORT, 'waiver_adjudication_queue_active');
    END;
  CREATE TRIGGER IF NOT EXISTS review_run_queue_reference_delete
    BEFORE DELETE ON review_runs
    WHEN EXISTS (
      SELECT 1 FROM codex_execution_queue
      WHERE work_kind = 'review_run' AND work_id = OLD.id
    )
    BEGIN SELECT RAISE(ABORT, 'codex_execution_queue_reference_in_use'); END;
  CREATE TRIGGER IF NOT EXISTS codex_execution_queue_claim_insert
    BEFORE INSERT ON codex_execution_queue
    WHEN (
      (NEW.worker_id IS NULL) <> (NEW.lease_expires_at IS NULL)
      OR (NEW.worker_id IS NULL AND NEW.fencing_token <> 0)
      OR (NEW.worker_id IS NOT NULL AND NEW.fencing_token <= 0)
    )
    BEGIN SELECT RAISE(ABORT, 'review_run_claim_invalid'); END;
  CREATE TRIGGER IF NOT EXISTS codex_execution_queue_claim_update
    BEFORE UPDATE OF worker_id, fencing_token, lease_expires_at
    ON codex_execution_queue
    WHEN (
      (NEW.worker_id IS NULL) <> (NEW.lease_expires_at IS NULL)
      OR (NEW.worker_id IS NULL AND NEW.fencing_token <> 0)
      OR (NEW.worker_id IS NOT NULL AND NEW.fencing_token <= 0)
      OR (
        NEW.worker_id IS NOT OLD.worker_id
        AND NEW.fencing_token <= OLD.fencing_token
      )
    )
    BEGIN SELECT RAISE(ABORT, 'review_run_claim_invalid'); END;
  CREATE TRIGGER IF NOT EXISTS codex_execution_queue_process_group_update
    BEFORE UPDATE OF
      process_group_id,
      process_group_recorded_at,
      process_boot_identity,
      process_namespace_identity,
      process_start_identity
    ON codex_execution_queue
    WHEN (
      OLD.process_group_id IS NOT NULL
      OR NEW.process_group_id IS NULL
      OR NEW.process_group_id <= 0
      OR NEW.process_group_recorded_at IS NULL
      OR NEW.process_boot_identity IS NULL
      OR length(trim(NEW.process_boot_identity)) = 0
      OR NEW.process_namespace_identity IS NULL
      OR length(trim(NEW.process_namespace_identity)) = 0
      OR NEW.process_start_identity IS NULL
      OR length(trim(NEW.process_start_identity)) = 0
      OR NEW.started_at IS NULL
      OR NEW.process_group_recorded_at < NEW.started_at
    )
    BEGIN
      SELECT RAISE(ABORT, 'codex_execution_process_group_invalid');
    END;
  CREATE TRIGGER IF NOT EXISTS codex_execution_queue_process_group_finish
    BEFORE UPDATE OF process_group_finished_at
    ON codex_execution_queue
    WHEN (
      OLD.process_group_finished_at IS NOT NULL
      OR NEW.process_group_finished_at IS NULL
      OR NEW.process_group_id IS NULL
      OR NEW.process_group_recorded_at IS NULL
      OR NEW.process_group_finished_at < NEW.process_group_recorded_at
    )
    BEGIN
      SELECT RAISE(ABORT, 'codex_execution_process_group_finish_invalid');
    END;
  CREATE TRIGGER IF NOT EXISTS codex_execution_queue_recovery_update
    BEFORE UPDATE OF recovery_termination_signal, recovered_at
    ON codex_execution_queue
    WHEN (
      OLD.recovered_at IS NOT NULL
      OR NEW.recovered_at IS NULL
      OR NEW.started_at IS NULL
      OR NEW.recovered_at < NEW.started_at
      OR (
        NEW.recovery_termination_signal IS NOT NULL
        AND NEW.recovery_termination_signal NOT IN ('SIGTERM', 'SIGKILL')
      )
    )
    BEGIN
      SELECT RAISE(ABORT, 'codex_execution_recovery_invalid');
    END;
  CREATE TRIGGER IF NOT EXISTS codex_execution_queue_recovery_integrity_insert
    BEFORE INSERT ON codex_execution_queue
    WHEN NOT (
      (
        (NEW.process_group_id IS NULL
          AND NEW.process_group_recorded_at IS NULL
          AND NEW.process_boot_identity IS NULL
          AND NEW.process_namespace_identity IS NULL
          AND NEW.process_start_identity IS NULL)
        OR
        (NEW.process_group_id IS NOT NULL
          AND NEW.process_group_id > 0
          AND NEW.process_group_recorded_at IS NOT NULL
          AND NEW.process_boot_identity IS NOT NULL
          AND length(trim(NEW.process_boot_identity)) > 0
          AND NEW.process_namespace_identity IS NOT NULL
          AND length(trim(NEW.process_namespace_identity)) > 0
          AND NEW.process_start_identity IS NOT NULL
          AND length(trim(NEW.process_start_identity)) > 0
          AND NEW.started_at IS NOT NULL
          AND NEW.process_group_recorded_at >= NEW.started_at)
      )
      AND (
        NEW.process_group_finished_at IS NULL
        OR
        (NEW.process_group_id IS NOT NULL
          AND NEW.process_group_recorded_at IS NOT NULL
          AND NEW.process_group_finished_at
            >= NEW.process_group_recorded_at)
      )
      AND (
        (NEW.recovered_at IS NULL
          AND NEW.recovery_termination_signal IS NULL)
        OR
        (NEW.recovered_at IS NOT NULL
          AND NEW.started_at IS NOT NULL
          AND NEW.recovered_at >= NEW.started_at
          AND (
            NEW.recovery_termination_signal IS NULL
            OR NEW.recovery_termination_signal IN ('SIGTERM', 'SIGKILL')
          ))
      )
    )
    BEGIN
      SELECT RAISE(ABORT, 'codex_execution_recovery_integrity_invalid');
    END;
  CREATE TRIGGER IF NOT EXISTS codex_execution_queue_recovery_integrity_update
    BEFORE UPDATE OF
      started_at,
      process_group_id,
      process_group_recorded_at,
      process_boot_identity,
      process_namespace_identity,
      process_start_identity,
      process_group_finished_at,
      recovery_termination_signal,
      recovered_at
    ON codex_execution_queue
    WHEN NOT (
      (
        (NEW.process_group_id IS NULL
          AND NEW.process_group_recorded_at IS NULL
          AND NEW.process_boot_identity IS NULL
          AND NEW.process_namespace_identity IS NULL
          AND NEW.process_start_identity IS NULL)
        OR
        (NEW.process_group_id IS NOT NULL
          AND NEW.process_group_id > 0
          AND NEW.process_group_recorded_at IS NOT NULL
          AND NEW.process_boot_identity IS NOT NULL
          AND length(trim(NEW.process_boot_identity)) > 0
          AND NEW.process_namespace_identity IS NOT NULL
          AND length(trim(NEW.process_namespace_identity)) > 0
          AND NEW.process_start_identity IS NOT NULL
          AND length(trim(NEW.process_start_identity)) > 0
          AND NEW.started_at IS NOT NULL
          AND NEW.process_group_recorded_at >= NEW.started_at)
      )
      AND (
        NEW.process_group_finished_at IS NULL
        OR
        (NEW.process_group_id IS NOT NULL
          AND NEW.process_group_recorded_at IS NOT NULL
          AND NEW.process_group_finished_at
            >= NEW.process_group_recorded_at)
      )
      AND (
        (NEW.recovered_at IS NULL
          AND NEW.recovery_termination_signal IS NULL)
        OR
        (NEW.recovered_at IS NOT NULL
          AND NEW.started_at IS NOT NULL
          AND NEW.recovered_at >= NEW.started_at
          AND (
            NEW.recovery_termination_signal IS NULL
            OR NEW.recovery_termination_signal IN ('SIGTERM', 'SIGKILL')
          ))
      )
    )
    BEGIN
      SELECT RAISE(ABORT, 'codex_execution_recovery_integrity_invalid');
    END;
`;
