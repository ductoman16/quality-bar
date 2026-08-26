export const RETENTION_PERIOD_MS = 90 * 24 * 60 * 60 * 1_000;

const RETENTION_DELETES = Object.freeze([
  [
    "codexExecutionAttempts",
    `DELETE FROM codex_execution_pre_start_attempts
     WHERE started_at < ?
       AND NOT EXISTS (
         SELECT 1
         FROM codex_execution_queue AS queue
         WHERE queue.work_id = codex_execution_pre_start_attempts.work_id
           AND queue.work_kind = codex_execution_pre_start_attempts.work_kind
           AND queue.started_at IS NULL
           AND queue.retry_state = 'ready'
           AND queue.worker_id IS NOT NULL
       )`,
  ],
  [
    "reviewRunAttempts",
    "DELETE FROM review_run_pre_start_attempts WHERE failed_at < ?",
  ],
  [
    "waiverAdjudicationAttempts",
    "DELETE FROM waiver_adjudication_pre_start_attempts WHERE failed_at < ?",
  ],
  ["applicationLogs", "DELETE FROM application_logs WHERE occurred_at < ?"],
]);

/**
 * Delete only noncanonical operational detail older than the fixed retention
 * period. The durable access layer supplies the only transaction that can
 * temporarily authorize the immutable-detail delete triggers.
 */
export function cleanupEligibleRetentionData({
  durableCore,
  now,
}: {
  durableCore: {
    retentionTransaction: (
      callback: (transaction: {
        run: (sql: string, ...parameters: any[]) => any;
      }) => any,
    ) => any;
  };
  now: () => number;
}) {
  if (typeof durableCore?.retentionTransaction !== "function") {
    throw new TypeError("retention transaction is required");
  }
  if (typeof now !== "function") {
    throw new TypeError("retention clock is required");
  }
  const current = now();
  if (!Number.isSafeInteger(current) || current < 0) {
    throw new TypeError("retention time is invalid");
  }
  const cutoff = current - RETENTION_PERIOD_MS;
  return durableCore.retentionTransaction((transaction) => {
    const changes = {} as Record<string, { changes: number }>;
    for (const [name, sql] of RETENTION_DELETES) {
      const result = transaction.run(sql, cutoff);
      if (!Number.isSafeInteger(result?.changes) || result.changes < 0) {
        throw new TypeError("retention delete result is invalid");
      }
      changes[name] = { changes: result.changes };
    }
    return changes;
  });
}
