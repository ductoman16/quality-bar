import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import {
  RETENTION_PERIOD_MS,
  cleanupEligibleRetentionData,
} from "../src/retention.js";
import { hasRetentionSchema } from "../src/retention-schema.js";

test("retention cleanup uses one exact ninety-day cutoff and deletes only eligible detail", () => {
  const calls = /** @type {[string, number][]} */ ([]);
  const result = cleanupEligibleRetentionData({
    durableCore: {
      retentionTransaction(callback) {
        return callback({
          run(sql, cutoff) {
            calls.push([sql, cutoff]);
            return { changes: 1 };
          },
        });
      },
    },
    now: () => 100 * 24 * 60 * 60 * 1_000,
  });

  assert.deepEqual(result, {
    applicationLogs: { changes: 1 },
    codexExecutionAttempts: { changes: 1 },
    reviewRunAttempts: { changes: 1 },
    waiverAdjudicationAttempts: { changes: 1 },
  });
  assert.equal(calls.length, 4);
  assert.equal(
    calls.every(([, cutoff]) => cutoff === 10 * 24 * 60 * 60 * 1_000),
    true,
  );
  assert.equal(
    calls[0][0],
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
  );
  assert.equal(
    calls[1][0],
    "DELETE FROM review_run_pre_start_attempts WHERE failed_at < ?",
  );
  assert.equal(
    calls[2][0],
    "DELETE FROM waiver_adjudication_pre_start_attempts WHERE failed_at < ?",
  );
  assert.equal(
    calls[3][0],
    "DELETE FROM application_logs WHERE occurred_at < ?",
  );
  assert.equal(RETENTION_PERIOD_MS, 90 * 24 * 60 * 60 * 1_000);
});

test("retention cleanup fails fast when its guarded durable seam is absent", () => {
  assert.throws(
    () =>
      cleanupEligibleRetentionData({
        durableCore: /** @type {any} */ ({ transaction() {} }),
        now: () => 0,
      }),
    /retention transaction is required/,
  );
});

test("retention migration rejects a malformed application-log table", () => {
  const database = new DatabaseSync(":memory:");
  database.exec("CREATE TABLE application_logs (id TEXT PRIMARY KEY)");
  assert.throws(
    () => hasRetentionSchema(database),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "schema_invalid",
  );
  database.close();
});
