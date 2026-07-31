import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createApplicationShutdownBoundary } from "../src/application-shutdown.js";
import { createCodexExecutionClaimService } from "../src/codex-execution-claim.js";
import { createStorageGuardedClaimService } from "../src/codex-execution-runtime.js";
import { openDurableCore } from "../src/durable-core.js";
import { createEvaluationService } from "../src/evaluation.js";
import { createIoExecutionPool } from "../src/io-execution-pool.js";
import { executeReviewRun } from "../src/review-run-execution.js";
import { createQueuedReviewRun } from "./review-run-claim-support.js";

test("shutdown racing acquired work stores no Evaluation or idempotency fact", async (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-shutdown-admission-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  core.run(
    "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES (?, ?, ?, ?)",
    "repository-1",
    "https://example.invalid/repository.git",
    1,
    1,
  );
  const acquired = Promise.withResolvers();
  let released = 0;
  const shutdown = createApplicationShutdownBoundary();
  const storageReserve = shutdown.guardStorageReserve({
    assertCodexStartAvailable() {},
    assertPollingObservationAdvanceAvailable() {},
    assertWorkAdmissionAvailable() {},
    cleanupEligibleData() {},
    preparePollingObservationAdvance() {},
    readFacts: () => ({ status: "available" }),
  });
  const service = createEvaluationService(core, {
    acquireChangeset: () => acquired.promise,
    createId: () => "must-not-be-stored",
    masterKey: Buffer.alloc(32, 7),
    now: () => 10,
    readCodexCapabilityFailure: () => null,
    storageReserve,
  });
  const creation = service.createExplicit({
    channel: "implementer_token",
    idempotencyKey: "shutdown-race",
    repositoryId: "repository-1",
    request: {
      base: { type: "branch", value: "main" },
      head: { type: "branch", value: "topic" },
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  const failure = shutdown.begin();
  acquired.resolve({
    base_commit: "a".repeat(40),
    head_commit: "b".repeat(40),
    release() {
      released += 1;
    },
  });

  await assert.rejects(
    creation,
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "application_shutting_down" &&
      error.message === "Quality Bar is shutting down" &&
      error.cause === failure,
  );
  assert.equal(released, 1);
  assert.equal(core.get("SELECT count(*) AS count FROM evaluations")?.count, 0);
  assert.equal(
    core.get("SELECT count(*) AS count FROM evaluation_idempotency")?.count,
    0,
  );
});

test("shutdown before Codex launch keeps claimed work queued with its bounded retry", async (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-shutdown-pre-start-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  await createQueuedReviewRun(core);
  const claims = createCodexExecutionClaimService(core, {
    createWorkerId: () => "shutdown-pre-start-worker",
    now: () => 20,
  });
  const claim = claims.claimNext();
  assert.ok(claim);
  const shutdown = createApplicationShutdownBoundary();
  const guardedClaims = createStorageGuardedClaimService(
    claims,
    shutdown.guardStorageReserve({
      assertCodexStartAvailable() {},
      assertPollingObservationAdvanceAvailable() {},
      assertWorkAdmissionAvailable() {},
      cleanupEligibleData() {},
      preparePollingObservationAdvance() {},
      readFacts: () => ({ status: "available" }),
    }),
  );
  const ioPool = createIoExecutionPool();
  const failure = shutdown.begin();

  await assert.rejects(
    executeReviewRun(core, claim, {
      claimService: guardedClaims,
      ioPool,
      prepareCheckout: async () => ({ path: directory, remove() {} }),
      readFileChanges: () => [],
      resultService: { fail: assert.fail, prepare: assert.fail },
      async runCodex({ startProcessGroup }) {
        startProcessGroup(4321);
        return { diagnosticFailures: [] };
      },
    }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "application_shutting_down" &&
      error.cause === failure,
  );
  await ioPool.close();

  assert.deepEqual(
    core.get(
      `SELECT review_runs.execution_status, review_runs.pre_start_cycle_attempt_count,
              codex_execution_queue.started_at, codex_execution_queue.ready_at,
              codex_execution_queue.lease_expires_at
       FROM review_runs
       JOIN codex_execution_queue
         ON codex_execution_queue.work_id = review_runs.id
       WHERE review_runs.id = 'review-run-1'`,
    ),
    {
      execution_status: "queued",
      lease_expires_at: 20,
      pre_start_cycle_attempt_count: 1,
      ready_at: 60_020,
      started_at: null,
    },
  );
  assert.deepEqual(
    core.get(
      `SELECT error_code, error_detail, exhausted
       FROM review_run_pre_start_attempts
       WHERE review_run_id = 'review-run-1'`,
    ),
    {
      error_code: "application_shutting_down",
      error_detail: "Quality Bar is shutting down",
      exhausted: 0,
    },
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM evaluation_results")?.count,
    0,
  );
});
