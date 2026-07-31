import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { createReviewRunClaimService } from "../src/review-run-claim.js";
import { cleanupEligibleRetentionData } from "../src/retention.js";
import { createQueuedReviewRun } from "./review-run-claim-support.js";

test("SQLite retention removes only old operational detail while preserving permanent facts", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-retention-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const now = 100 * 24 * 60 * 60 * 1_000;
  const old = 10;
  const recent = now - 89 * 24 * 60 * 60 * 1_000;
  const core = openDurableCore(join(directory, "quality-bar.sqlite"));
  context.after(() => core.close());

  await createQueuedReviewRun(core);
  const claim = createReviewRunClaimService(core, {
    createWorkerId: () => "retention-worker",
    now: () => old,
  }).claimNext();
  assert.ok(claim);
  createReviewRunClaimService(core, {
    createWorkerId: () => "retention-worker",
    now: () => old,
  }).recordPreStartFailure(
    claim,
    Object.assign(new Error("Old checkout failure token=opaque-owned-token"), {
      code: "repository_permission_denied",
    }),
  );

  core.run(
    `INSERT INTO application_logs (
       id, occurred_at, severity, event, component, outcome, message
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    "old-log",
    old,
    "error",
    "old_event",
    "test",
    "failure",
    "old safe detail",
  );
  core.run(
    `INSERT INTO application_logs (
       id, occurred_at, severity, event, component, outcome, message
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    "recent-log",
    recent,
    "info",
    "recent_event",
    "test",
    "success",
    "recent safe detail",
  );
  core.run(
    `INSERT INTO quality_bar_metadata (key, value) VALUES (?, ?)`,
    "retention-canonical-fact",
    "must remain",
  );
  assert.throws(
    () =>
      core.run(
        "DELETE FROM review_run_pre_start_attempts WHERE review_run_id = ?",
        "review-run-1",
      ),
    /review_run_pre_start_attempt_immutable/,
  );

  const result = cleanupEligibleRetentionData({
    durableCore: core,
    now: () => now,
  });

  assert.equal(result.applicationLogs.changes, 1);
  assert.deepEqual(core.all("SELECT id FROM application_logs ORDER BY id"), [
    { id: "recent-log" },
  ]);
  assert.deepEqual(
    core.get(
      "SELECT value FROM quality_bar_metadata WHERE key = ?",
      "retention-canonical-fact",
    ),
    { value: "must remain" },
  );
  assert.deepEqual(
    core.get(
      `SELECT pre_start_attempt_count, pre_start_retry_error_code,
              pre_start_retry_error_detail
       FROM review_runs WHERE id = 'review-run-1'`,
    ),
    {
      pre_start_attempt_count: 1,
      pre_start_retry_error_code: "repository_permission_denied",
      pre_start_retry_error_detail: "Old checkout failure token: [REDACTED]",
    },
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM codex_execution_pre_start_attempts")
      ?.count,
    0,
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM review_run_pre_start_attempts")
      ?.count,
    0,
  );
  assert.equal(
    core.get(
      "SELECT retry_state FROM codex_execution_queue WHERE work_id = 'review-run-1'",
    )?.retry_state,
    "exhausted",
  );
});

test("SQLite retention write failure is the exact owning storage error", (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-retention-failure-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite"));
  context.after(() => core.close());
  core.run("PRAGMA query_only = ON");

  assert.throws(
    () => cleanupEligibleRetentionData({ durableCore: core, now: () => 0 }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "storage_unavailable",
  );
});

test("SQLite retention preserves an old in-flight pre-start marker for claim recovery", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-retention-claim-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const startedAt = 10;
  const now = 100 * 24 * 60 * 60 * 1_000;
  const core = openDurableCore(join(directory, "quality-bar.sqlite"));
  context.after(() => core.close());
  await createQueuedReviewRun(core);

  const claimService = createReviewRunClaimService(core, {
    createWorkerId: () => "retention-claim-worker",
    now: () => startedAt,
  });
  const claim = claimService.claimNext();
  assert.ok(claim);
  claimService.beginPreStartAttempt(claim);

  cleanupEligibleRetentionData({ durableCore: core, now: () => now });

  assert.equal(
    core.get(
      `SELECT count(*) AS count
       FROM codex_execution_pre_start_attempts
       WHERE work_id = 'review-run-1'`,
    )?.count,
    1,
  );

  const recoveryService = createReviewRunClaimService(core, {
    createWorkerId: () => "retention-recovery-worker",
    now: () => now,
  });
  assert.equal(recoveryService.claimNext(), undefined);
  assert.deepEqual(
    core.get(
      `SELECT pre_start_attempt_count, pre_start_retry_error_code
       FROM review_runs WHERE id = 'review-run-1'`,
    ),
    {
      pre_start_attempt_count: 1,
      pre_start_retry_error_code: "codex_pre_start_interrupted",
    },
  );
});
