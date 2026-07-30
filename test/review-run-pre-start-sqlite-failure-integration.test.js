import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { recoverCodexExecutions } from "../src/codex-execution-recovery.js";
import { createReviewRunClaimService } from "../src/review-run-claim.js";
import { createQueuedReviewRun } from "./review-run-claim-support.js";

/** @param {import("node:test").TestContext} context */
async function fixture(context) {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-run-retry-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite"));
  context.after(() => core.close());
  await createQueuedReviewRun(core);
  return core;
}

test("Review Run checkout failures persist one-minute and five-minute attempts before exhaustion", async (context) => {
  const core = await fixture(context);
  let currentTime = 20;
  let worker = 0;
  const claims = createReviewRunClaimService(core, {
    clearInterval() {},
    createWorkerId: () => `worker-${++worker}`,
    now: () => currentTime,
    setInterval: () => 1,
  });
  const failure = Object.assign(
    new Error("Temporary Review Run checkout failure"),
    {
      code: "review_run_checkout_failed",
    },
  );

  const first = claims.claimNext();
  assert.ok(first);
  assert.deepEqual(claims.recordPreStartFailure(first, failure), {
    attemptNumber: 1,
    exhausted: false,
    nextAttemptAt: 60_020,
    retryCycle: 1,
  });
  currentTime = 60_020;
  const second = claims.claimNext();
  assert.ok(second);
  assert.deepEqual(claims.recordPreStartFailure(second, failure), {
    attemptNumber: 2,
    exhausted: false,
    nextAttemptAt: 360_020,
    retryCycle: 1,
  });
  currentTime = 360_020;
  const third = claims.claimNext();
  assert.ok(third);
  assert.deepEqual(claims.recordPreStartFailure(third, failure), {
    attemptNumber: 3,
    exhausted: true,
    nextAttemptAt: null,
    retryCycle: 1,
  });

  assert.deepEqual(
    core.all(
      `SELECT retry_cycle, attempt_number, failed_at, error_code, exhausted
       FROM review_run_pre_start_attempts
       ORDER BY attempt_number`,
    ),
    [
      {
        attempt_number: 1,
        error_code: "review_run_checkout_failed",
        exhausted: 0,
        failed_at: 20,
        retry_cycle: 1,
      },
      {
        attempt_number: 2,
        error_code: "review_run_checkout_failed",
        exhausted: 0,
        failed_at: 60_020,
        retry_cycle: 1,
      },
      {
        attempt_number: 3,
        error_code: "review_run_checkout_failed",
        exhausted: 1,
        failed_at: 360_020,
        retry_cycle: 1,
      },
    ],
  );
  assert.deepEqual(
    core.get(
      `SELECT review_runs.execution_status, codex_execution_queue.retry_state
       FROM review_runs
       JOIN codex_execution_queue
         ON codex_execution_queue.work_id = review_runs.id
       WHERE review_runs.id = 'review-run-1'`,
    ),
    { execution_status: "queued", retry_state: "exhausted" },
  );
});

test("definitive Review Run preparation failure exhausts immediately", async (context) => {
  const core = await fixture(context);
  const claims = createReviewRunClaimService(core, {
    createWorkerId: () => "worker-1",
    now: () => 20,
  });
  const claim = claims.claimNext();
  assert.ok(claim);
  assert.deepEqual(
    claims.recordPreStartFailure(
      claim,
      Object.assign(new Error("Repository permission denied"), {
        code: "repository_permission_denied",
      }),
    ),
    {
      attemptNumber: 1,
      exhausted: true,
      nextAttemptAt: null,
      retryCycle: 1,
    },
  );
});

test("a lost Review Run claim before attempt start consumes no attempt", async (context) => {
  const core = await fixture(context);
  const claims = createReviewRunClaimService(core, {
    createWorkerId: () => "worker-1",
    now: () => 20,
  });
  const claim = claims.claimNext();
  assert.ok(claim);
  core.run(
    `UPDATE codex_execution_queue
     SET lease_expires_at = 20
     WHERE work_id = 'review-run-1'`,
  );
  assert.throws(
    () =>
      claims.recordPreStartFailure(
        claim,
        Object.assign(new Error("Temporary Review Run checkout failure"), {
          code: "review_run_checkout_failed",
        }),
      ),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "review_run_claim_lost",
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM review_run_pre_start_attempts")
      ?.count,
    0,
  );
});

test("restart records an interrupted checkout attempt and preserves its remaining budget", async (context) => {
  const core = await fixture(context);
  const claims = createReviewRunClaimService(core, {
    createWorkerId: () => "interrupted-checkout-worker",
    now: () => 20,
  });
  const claim = claims.claimNext();
  assert.ok(claim);
  claims.beginPreStartAttempt(claim);

  recoverCodexExecutions(core, { now: () => 30 });

  assert.deepEqual(
    core.get(
      `SELECT retry_cycle, attempt_number, failed_at, error_code,
              error_detail, exhausted
       FROM review_run_pre_start_attempts
       WHERE review_run_id = 'review-run-1'`,
    ),
    {
      attempt_number: 1,
      error_code: "codex_pre_start_interrupted",
      error_detail:
        "Review Run pre-start attempt was interrupted by application restart",
      exhausted: 0,
      failed_at: 30,
      retry_cycle: 1,
    },
  );
  assert.deepEqual(
    core.get(
      `SELECT retry_state, ready_at, lease_expires_at
       FROM codex_execution_queue WHERE work_id = 'review-run-1'`,
    ),
    { lease_expires_at: 30, ready_at: 60_030, retry_state: "ready" },
  );
});

test("an expired live checkout attempt is reconciled before a replacement claim", async (context) => {
  const core = await fixture(context);
  let currentTime = 20;
  let worker = 0;
  const claims = createReviewRunClaimService(core, {
    createWorkerId: () => `worker-${++worker}`,
    now: () => currentTime,
  });
  const first = claims.claimNext();
  assert.ok(first);
  claims.beginPreStartAttempt(first);

  currentTime = first.leaseExpiresAt + 1;
  assert.equal(claims.claimNext(), undefined);
  assert.deepEqual(
    core.get(
      `SELECT attempt_number, failed_at, error_code, exhausted
       FROM review_run_pre_start_attempts
       WHERE review_run_id = 'review-run-1'`,
    ),
    {
      attempt_number: 1,
      error_code: "codex_pre_start_interrupted",
      exhausted: 0,
      failed_at: currentTime,
    },
  );

  currentTime += 60_000;
  const replacement = claims.claimNext();
  assert.ok(replacement);
  assert.equal(replacement.fencingToken, 2);
  assert.deepEqual(claims.beginPreStartAttempt(replacement), {
    attemptNumber: 2,
    retryCycle: 1,
    startedAt: currentTime,
  });
});

test("SQLite rejects fresh-cycle mutations until the exact exhausted cycle owns them", async (context) => {
  const core = await fixture(context);
  assert.throws(
    () =>
      core.run(
        "UPDATE review_runs SET retry_cycle = 2 WHERE id = 'review-run-1'",
      ),
    /review_run_retry_cycle_transition_invalid/,
  );

  const claims = createReviewRunClaimService(core, {
    createWorkerId: () => "worker-1",
    now: () => 20,
  });
  const claim = claims.claimNext();
  assert.ok(claim);
  claims.recordPreStartFailure(
    claim,
    Object.assign(new Error("Repository permission denied"), {
      code: "repository_permission_denied",
    }),
  );

  assert.throws(
    () =>
      core.run(
        `UPDATE codex_execution_queue SET retry_state = 'ready'
         WHERE work_id = 'review-run-1'`,
      ),
    /review_run_retry_transition_invalid/,
  );
  assert.throws(
    () =>
      core.run(
        "UPDATE review_runs SET retry_cycle = 3 WHERE id = 'review-run-1'",
      ),
    /review_run_retry_cycle_transition_invalid/,
  );
});
