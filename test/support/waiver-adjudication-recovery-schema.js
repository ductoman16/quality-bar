/** @param {{run: (sql: string) => unknown}} transaction */
export function removeWaiverAdjudicationRecoverySchema(transaction) {
  transaction.run("DROP TRIGGER IF EXISTS review_run_exhausted_start");
  transaction.run("DROP TRIGGER IF EXISTS review_run_retry_cycle_transition");
  transaction.run("DROP TRIGGER IF EXISTS review_run_retry_transition");
  transaction.run(
    "DROP TRIGGER IF EXISTS review_run_pre_start_attempt_exhaust",
  );
  transaction.run("DROP TRIGGER IF EXISTS review_run_pre_start_attempt_insert");
  transaction.run("DROP TABLE IF EXISTS evaluation_pre_start_retries");
  transaction.run("DROP TABLE IF EXISTS review_run_pre_start_attempts");
  transaction.run(
    "DROP TRIGGER IF EXISTS codex_execution_pre_start_attempt_immutable_delete",
  );
  transaction.run(
    "DROP TRIGGER IF EXISTS codex_execution_pre_start_attempt_immutable_update",
  );
  transaction.run(
    "DROP TRIGGER IF EXISTS codex_execution_pre_start_attempt_insert",
  );
  transaction.run("DROP TABLE IF EXISTS codex_execution_pre_start_attempts");
  transaction.run("ALTER TABLE review_runs DROP COLUMN retry_cycle");
  transaction.run("DROP TRIGGER IF EXISTS waiver_adjudication_exhausted_start");
  transaction.run(
    "DROP TRIGGER IF EXISTS waiver_adjudication_pre_start_attempt_exhaust",
  );
  transaction.run(
    "DROP TRIGGER IF EXISTS waiver_adjudication_pre_start_attempt_insert",
  );
  transaction.run(
    "DROP TRIGGER IF EXISTS waiver_adjudication_pre_start_attempt_immutable_delete",
  );
  transaction.run(
    "DROP TRIGGER IF EXISTS waiver_adjudication_pre_start_attempt_immutable_update",
  );
  transaction.run(
    "DROP TRIGGER IF EXISTS waiver_adjudication_retry_transition",
  );
  transaction.run(
    "DROP TRIGGER IF EXISTS waiver_recovery_idempotency_immutable_delete",
  );
  transaction.run(
    "DROP TRIGGER IF EXISTS waiver_recovery_idempotency_immutable_update",
  );
  transaction.run("DROP TABLE IF EXISTS waiver_recovery_idempotency");
  transaction.run(
    "DROP TABLE IF EXISTS waiver_adjudication_pre_start_attempts",
  );
  transaction.run("ALTER TABLE waiver_adjudications DROP COLUMN retry_cycle");
}
