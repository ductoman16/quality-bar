export const CODEX_EXECUTION_RECOVERY_COLUMNS = `
  process_group_id INTEGER CHECK (
    process_group_id IS NULL OR process_group_id > 0
  ),
  process_group_recorded_at INTEGER,
  process_group_finished_at INTEGER,
  recovery_termination_signal TEXT CHECK (
    recovery_termination_signal IS NULL
    OR recovery_termination_signal IN ('SIGTERM', 'SIGKILL')
  ),
  recovered_at INTEGER,
`;

export const CODEX_EXECUTION_RECOVERY_CHECKS = `
  CHECK (
    (process_group_id IS NULL AND process_group_recorded_at IS NULL)
    OR
    (process_group_id IS NOT NULL
      AND process_group_recorded_at IS NOT NULL
      AND started_at IS NOT NULL
      AND process_group_recorded_at >= started_at)
  ),
  CHECK (
    process_group_finished_at IS NULL
    OR
    (process_group_id IS NOT NULL
      AND process_group_recorded_at IS NOT NULL
      AND process_group_finished_at >= process_group_recorded_at)
  ),
  CHECK (
    (recovered_at IS NULL AND recovery_termination_signal IS NULL)
    OR
    (recovered_at IS NOT NULL
      AND started_at IS NOT NULL
      AND recovered_at >= started_at)
  ),
`;
