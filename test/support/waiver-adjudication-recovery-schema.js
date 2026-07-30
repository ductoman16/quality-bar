/** @param {{run: (sql: string) => unknown}} transaction */
export function removeWaiverAdjudicationRecoverySchema(transaction) {
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
