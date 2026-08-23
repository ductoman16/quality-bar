import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createCodexExecutionClaimService } from "../src/codex/codex-execution-claim.js";
import { openDurableCore } from "../src/durable/durable-core.js";
import { createSystemResource } from "../src/system/system-resource.js";
import { seedQueuedCodexExecutionKinds } from "./codex-execution-ordering-support.js";

test("System distinguishes queued Evaluation work from running Waiver Adjudication work without hiding a lowered concurrency limit", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-system-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  const now = 10;
  seedQueuedCodexExecutionKinds(core, {
    adjudicationReadyAt: now,
    reviewRunReadyAt: now,
  });
  const claims = createCodexExecutionClaimService(core, {
    createWorkerId: () => "worker-a",
    now: () => now,
  });
  const running = claims.claimNext();
  assert.ok(running);
  claims.start(running, "0.145.0");

  const facts = createSystemResource(core, { now: () => now }).readFacts({
    browserSessions: { isBootstrapped: () => true },
    codex: { status: "available" },
    implementerToken: { status: "active" },
    storage: { status: "available" },
  });

  assert.deepEqual(facts.codex_execution, {
    concurrency: {
      maximum_running: 1,
      running_count: 1,
      start_gate: "no_new_start",
    },
    failures: [],
    queue: {
      count: 1,
      rows: [
        {
          evaluation_id: "evaluation-queued",
          execution_status: "queued",
          gate: { code: "no_new_start" },
          lease: {
            expires_at: null,
            fencing_token: 0,
            status: "unclaimed",
            worker_id: null,
          },
          next_attempt_at: "1970-01-01T00:00:00.010Z",
          pre_start_attempt_count: 0,
          queue_position: 1,
          retry_error: null,
          retry_state: "ready",
          review_run_id: "review-run-z",
          retry_cycle: 1,
        },
      ],
    },
    running: {
      count: 1,
      rows: [
        {
          execution_status: "running",
          gate: { code: "running" },
          lease: {
            expires_at: "1970-01-01T00:02:00.010Z",
            fencing_token: 1,
            status: "running",
            worker_id: "worker-a",
          },
          pre_start_attempt_count: 0,
          retry_error: null,
          retry_state: "ready",
          retry_cycle: 1,
          waiver_adjudication_id: "adjudication-a",
        },
      ],
    },
  });
});

test("System keeps delayed retry and terminal failure facts attached to their owning resources", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-system-failure-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  const now = 10;
  seedQueuedCodexExecutionKinds(core, {
    adjudicationReadyAt: now,
    reviewRunReadyAt: now,
  });
  const claims = createCodexExecutionClaimService(core, {
    createWorkerId: () => "worker-a",
    now: () => now,
  });
  const delayed = claims.claimNext();
  assert.ok(delayed);
  claims.recordPreStartFailure(
    delayed,
    Object.assign(new Error("Checkout preparation failed."), {
      code: "review_run_checkout_failed",
    }),
  );
  const failed = createCodexExecutionClaimService(core, {
    createWorkerId: () => "worker-b",
    now: () => now,
  }).claimNext();
  assert.ok(failed);
  createCodexExecutionClaimService(core, {
    createWorkerId: () => "unused-worker",
    now: () => now,
  }).start(failed, "0.145.0");
  core.run(
    `UPDATE review_runs SET execution_status = 'failed', completed_at = ?,
       error_code = ?, error_detail = ? WHERE id = ?`,
    20,
    "unexpected_execution_failure",
    "Exact Review Run failure.",
    "review-run-z",
  );

  const facts = createSystemResource(core, { now: () => now }).readFacts({
    browserSessions: { isBootstrapped: () => true },
    codex: { status: "available" },
    implementerToken: { status: "active" },
    storage: { status: "available" },
  });

  assert.deepEqual(facts.codex_execution.queue.rows, [
    {
      execution_status: "queued",
      gate: { code: "retry_delayed" },
      lease: {
        expires_at: "1970-01-01T00:00:00.010Z",
        fencing_token: 1,
        status: "released",
        worker_id: "worker-a",
      },
      next_attempt_at: "1970-01-01T00:01:00.010Z",
      pre_start_attempt_count: 1,
      queue_position: 1,
      retry_cycle: 1,
      retry_error: {
        code: "review_run_checkout_failed",
        detail: "Checkout preparation failed.",
      },
      retry_state: "ready",
      waiver_adjudication_id: "adjudication-a",
    },
  ]);
  assert.deepEqual(facts.codex_execution.failures, [
    {
      completed_at: "1970-01-01T00:00:00.020Z",
      error: {
        code: "unexpected_execution_failure",
        detail: "Exact Review Run failure.",
      },
      evaluation_id: "evaluation-queued",
      review_run_id: "review-run-z",
    },
  ]);
});

test("System marks an expired pre-start lease as stuck without inferring a retry", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-system-stuck-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  let now = 10;
  seedQueuedCodexExecutionKinds(core, {
    adjudicationReadyAt: now,
    reviewRunReadyAt: now,
  });
  const claim = createCodexExecutionClaimService(core, {
    createWorkerId: () => "worker-a",
    now: () => now,
  }).claimNext();
  assert.ok(claim);
  now = 120_010;

  const facts = createSystemResource(core, { now: () => now }).readFacts({
    browserSessions: { isBootstrapped: () => true },
    codex: { status: "available" },
    implementerToken: { status: "active" },
    storage: { status: "available" },
  });

  assert.deepEqual(facts.codex_execution.queue.rows[0], {
    execution_status: "queued",
    gate: { code: "lease_stuck" },
    lease: {
      expires_at: "1970-01-01T00:02:00.010Z",
      fencing_token: 1,
      status: "stuck",
      worker_id: "worker-a",
    },
    next_attempt_at: "1970-01-01T00:00:00.010Z",
    pre_start_attempt_count: 0,
    queue_position: 1,
    retry_cycle: 1,
    retry_error: null,
    retry_state: "ready",
    waiver_adjudication_id: "adjudication-a",
  });
});

test("System reports no-new-start while a live pre-start lease occupies concurrency", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-system-claim-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  const now = 10;
  seedQueuedCodexExecutionKinds(core, {
    adjudicationReadyAt: now,
    reviewRunReadyAt: now,
  });
  const claim = createCodexExecutionClaimService(core, {
    createWorkerId: () => "worker-a",
    now: () => now,
  }).claimNext();
  assert.ok(claim);

  const facts = createSystemResource(core, { now: () => now }).readFacts({
    browserSessions: { isBootstrapped: () => true },
    codex: { status: "available" },
    implementerToken: { status: "active" },
    storage: { status: "available" },
  });

  assert.equal(facts.codex_execution.concurrency.running_count, 0);
  assert.equal(facts.codex_execution.concurrency.start_gate, "no_new_start");
  assert.equal(facts.codex_execution.queue.rows[0].gate.code, "lease_held");
  assert.equal(facts.codex_execution.queue.rows[1].gate.code, "no_new_start");
});

test("System scopes pre-start attempts and errors to the current retry cycle", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-system-cycle-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  const now = 10;
  seedQueuedCodexExecutionKinds(core, {
    adjudicationReadyAt: now,
    reviewRunReadyAt: now,
  });
  const claim = createCodexExecutionClaimService(core, {
    createWorkerId: () => "worker-a",
    now: () => now,
  }).claimNext();
  assert.ok(claim);
  createCodexExecutionClaimService(core, {
    createWorkerId: () => "worker-a",
    now: () => now,
  }).recordPreStartFailure(
    claim,
    Object.assign(new Error("Checkout preparation failed."), {
      code: "review_run_checkout_failed",
    }),
  );
  core.run(
    "UPDATE waiver_adjudications SET retry_cycle = 2 WHERE id = ?",
    "adjudication-a",
  );

  const facts = createSystemResource(core, { now: () => now }).readFacts({
    browserSessions: { isBootstrapped: () => true },
    codex: { status: "available" },
    implementerToken: { status: "active" },
    storage: { status: "available" },
  });

  const adjudication = facts.codex_execution.queue.rows.find(
    (row) =>
      "waiver_adjudication_id" in row &&
      row.waiver_adjudication_id === "adjudication-a",
  );
  assert.ok(adjudication);
  assert.equal(adjudication.retry_cycle, 2);
  assert.equal(adjudication.pre_start_attempt_count, 0);
  assert.equal(adjudication.retry_error, null);
});

test("System reports an exhausted pre-start claim as released after its lease expires", (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-system-exhausted-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  let now = 10;
  seedQueuedCodexExecutionKinds(core, {
    adjudicationReadyAt: now,
    reviewRunReadyAt: now,
  });
  const claim = createCodexExecutionClaimService(core, {
    createWorkerId: () => "worker-a",
    now: () => now,
  }).claimNext();
  assert.ok(claim);
  core.run(
    "UPDATE codex_execution_queue SET retry_state = 'exhausted' WHERE work_id = ?",
    claim.workId,
  );
  now = 120_010;

  const facts = createSystemResource(core, { now: () => now }).readFacts({
    browserSessions: { isBootstrapped: () => true },
    codex: { status: "available" },
    implementerToken: { status: "active" },
    storage: { status: "available" },
  });
  const exhausted = facts.codex_execution.queue.rows.find(
    (row) =>
      "waiver_adjudication_id" in row &&
      row.waiver_adjudication_id === "adjudication-a",
  );
  assert.ok(exhausted);
  assert.equal(exhausted.gate.code, "retry_exhausted");
  assert.equal(exhausted.lease.status, "released");
});
