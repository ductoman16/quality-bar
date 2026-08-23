import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createCodexExecutionClaimService } from "../src/codex/codex-execution-claim.js";
import { createCodexExecutionConcurrencyService } from "../src/codex/codex-execution-concurrency.js";
import { openDurableCore } from "../src/durable/durable-core.js";
import { seedQueuedCodexExecutionKinds } from "./codex-execution-ordering-support.js";

test("ready_at then stable identity orders Review Runs and Waiver Adjudications together", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-ordering-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  seedQueuedCodexExecutionKinds(core, {
    adjudicationReadyAt: 10,
    reviewRunReadyAt: 10,
  });

  const claim = createCodexExecutionClaimService(core, {
    createWorkerId: () => "shared-worker",
    now: () => 10,
  }).claimNext();

  assert.equal(claim?.workId, "adjudication-a");
  assert.equal(claim?.workKind, "waiver_adjudication");
  assert.deepEqual(
    core.all(
      `SELECT work_id, work_kind, ready_at, worker_id
       FROM codex_execution_queue ORDER BY ready_at, work_id`,
    ),
    [
      {
        ready_at: 10,
        work_id: "adjudication-a",
        work_kind: "waiver_adjudication",
        worker_id: "shared-worker",
      },
      {
        ready_at: 10,
        work_id: "review-run-z",
        work_kind: "review_run",
        worker_id: null,
      },
    ],
  );
});

test("retry-exhausted work keeps its slot until the same identity is retried", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-ordering-slot-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  seedQueuedCodexExecutionKinds(core, {
    adjudicationReadyAt: 5,
    reviewRunReadyAt: 10,
  });
  createCodexExecutionConcurrencyService(core).set(2);
  core.run(
    `UPDATE codex_execution_queue SET retry_state = 'exhausted'
     WHERE work_id = 'adjudication-a'`,
  );

  const claims = createCodexExecutionClaimService(core, {
    createWorkerId: () => "shared-worker",
    now: () => 10,
  });
  const claim = claims.claimNext();

  assert.equal(claim?.workId, "review-run-z");
  assert.deepEqual(
    core.all(
      `SELECT work_id, ready_at, retry_state
       FROM codex_execution_queue
       ORDER BY ready_at, work_id`,
    ),
    [
      {
        ready_at: 5,
        retry_state: "exhausted",
        work_id: "adjudication-a",
      },
      { ready_at: 10, retry_state: "ready", work_id: "review-run-z" },
    ],
  );
  core.run(
    `UPDATE codex_execution_queue
     SET retry_state = 'ready', ready_at = 30
     WHERE work_id = 'adjudication-a'`,
  );
  assert.equal(
    createCodexExecutionClaimService(core, {
      createWorkerId: () => "retry-worker",
      now: () => 30,
    }).claimNext()?.workId,
    "adjudication-a",
  );
});

test("an invalid Waiver Adjudication start surfaces its owning error and rolls back the queue start", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-order-state-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  seedQueuedCodexExecutionKinds(core, {
    adjudicationReadyAt: 10,
    reviewRunReadyAt: 20,
  });
  core.run(
    `UPDATE waiver_adjudications
     SET execution_status = 'failed',
         error_code = 'waiver_adjudication_failed',
         error_detail = 'Exact adjudication failure.'
     WHERE id = 'adjudication-a'`,
  );
  const claims = createCodexExecutionClaimService(core, {
    createWorkerId: () => "shared-worker",
    now: () => 20,
  });
  const claim = claims.claimNext();
  assert.equal(claim?.workKind, "waiver_adjudication");

  assert.throws(
    () => claims.start(claim, "0.145.0"),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "waiver_adjudication_state_invalid" &&
      error.message === "Waiver Adjudication is not queued for launch",
  );
  assert.equal(
    core.get(
      "SELECT started_at FROM codex_execution_queue WHERE work_id = 'adjudication-a'",
    )?.started_at,
    null,
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM waiver_decisions")?.count,
    0,
  );
});
