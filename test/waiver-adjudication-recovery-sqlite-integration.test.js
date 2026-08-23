import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openDurableCore } from "../src/durable/durable-core.js";
import { createWaiverAdjudicationRecoveryService } from "../src/waiver/waiver-adjudication-recovery.js";
import { createWaiverAdjudicationResultService } from "../src/waiver/waiver-adjudication-result-service.js";
import { createWaiverBatchService } from "../src/waiver/waiver-batch.js";
import { seedCompletedEvaluation } from "./support/waiver-batch-fixture.js";

/** @param {import("node:test").TestContext} context */
function createFixture(context) {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-waiver-recovery-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite"));
  context.after(() => core.close());
  seedCompletedEvaluation(core);
  const adjudicationIds = ["adjudication-1", "adjudication-2"];
  const batches = createWaiverBatchService(core, {
    createAdjudicationId: () =>
      adjudicationIds.shift() ?? assert.fail("missing Adjudication identity"),
    createRequestId: () => "request-1",
    now: () => 10,
    readCodexCapabilityFailure: () => null,
    storageReserve: { assertWorkAdmissionAvailable() {} },
  });
  batches.submit({
    channel: "browser_session",
    evaluationId: "evaluation-1",
    idempotencyKey: "waiver-key",
    request: {
      requests: [
        {
          finding_id: "finding-1",
          rationale: "Exact immutable exception rationale.",
        },
      ],
    },
  });
  const recoveries = createWaiverAdjudicationRecoveryService(core, {
    createAdjudicationId: () =>
      adjudicationIds.shift() ?? assert.fail("missing recovery identity"),
    now: () => 30,
    readCodexCapabilityFailure: () => null,
    storageReserve: { assertWorkAdmissionAvailable() {} },
  });
  return { batches, core, recoveries };
}

test("pre-start exhaustion retries the same accepted Adjudication and preserves attempts", (context) => {
  const { core, recoveries } = createFixture(context);
  core.run(
    `INSERT INTO waiver_adjudication_pre_start_attempts (
       waiver_adjudication_id, retry_cycle, attempt_number,
       failed_at, error_code, error_detail, exhausted
     ) VALUES (
       'adjudication-1', 1, 3, 20, 'repository_git_read_failed',
       'The frozen Repository could not be prepared.', 1
     )`,
  );

  const recovered = recoveries.recover({
    adjudicationId: "adjudication-1",
    channel: "browser_session",
    idempotencyKey: "recover-same-identity",
  });

  assert.equal(recovered.status, 200);
  assert.equal(recovered.resource.adjudication.id, "adjudication-1");
  assert.deepEqual(
    core.get(
      `SELECT codex_execution_queue.retry_state,
              waiver_adjudications.retry_cycle
       FROM waiver_adjudications
       JOIN codex_execution_queue
         ON codex_execution_queue.work_id = waiver_adjudications.id
       WHERE waiver_adjudications.id = 'adjudication-1'`,
    ),
    { retry_cycle: 2, retry_state: "ready" },
  );
  assert.deepEqual(
    core.get(
      `SELECT ready_at, accepted_at, started_at
       FROM codex_execution_queue WHERE work_id = 'adjudication-1'`,
    ),
    { accepted_at: 10, ready_at: 30, started_at: null },
  );
  assert.equal(
    core.get(
      `SELECT count(*) AS count
       FROM waiver_adjudication_pre_start_attempts
       WHERE waiver_adjudication_id = 'adjudication-1'`,
    )?.count,
    1,
  );
  assert.deepEqual(
    recoveries.recover({
      adjudicationId: "adjudication-1",
      channel: "browser_session",
      idempotencyKey: "recover-same-identity",
    }),
    recovered,
  );
});

test("started process failure recovers undecided Requests in a new Adjudication", (context) => {
  const { core, recoveries } = createFixture(context);
  core.run(
    `UPDATE codex_execution_queue
     SET worker_id = 'worker-1', fencing_token = 1,
         lease_expires_at = 100, started_at = 11
     WHERE work_id = 'adjudication-1'`,
  );
  core.run(
    `UPDATE waiver_adjudications
     SET execution_status = 'running', started_at = 11,
         codex_cli_version = '0.145.0'
     WHERE id = 'adjudication-1'`,
  );
  createWaiverAdjudicationResultService(core, { now: () => 20 }).fail(
    {
      fencingToken: 1,
      workerId: "worker-1",
      workId: "adjudication-1",
    },
    Object.assign(new Error("Codex exited without an accepted Decision set"), {
      code: "result_not_submitted",
    }),
  );

  const recovered = recoveries.recover({
    adjudicationId: "adjudication-1",
    channel: "browser_session",
    idempotencyKey: "recover-started-failure",
  });

  assert.equal(recovered.status, 201);
  assert.equal(recovered.resource.adjudication.id, "adjudication-2");
  assert.deepEqual(recovered.resource.adjudication.request_ids, ["request-1"]);
  assert.deepEqual(
    core.all(
      `SELECT id, execution_status FROM waiver_adjudications ORDER BY rowid`,
    ),
    [
      { execution_status: "failed", id: "adjudication-1" },
      { execution_status: "queued", id: "adjudication-2" },
    ],
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM waiver_decisions")?.count,
    0,
  );
});

test("competing started recoveries return the active Adjudication error", (context) => {
  const { core, recoveries } = createFixture(context);
  core.run(
    `UPDATE codex_execution_queue
     SET started_at = 11
     WHERE work_id = 'adjudication-1'`,
  );
  core.run(
    `UPDATE waiver_adjudications
     SET execution_status = 'failed', started_at = 11, completed_at = 20,
         error_code = 'result_not_submitted',
         error_detail = 'No complete Decision set was submitted.'
     WHERE id = 'adjudication-1'`,
  );
  recoveries.recover({
    adjudicationId: "adjudication-1",
    channel: "browser_session",
    idempotencyKey: "first-recovery",
  });
  assert.throws(
    () =>
      recoveries.recover({
        adjudicationId: "adjudication-1",
        channel: "browser_session",
        idempotencyKey: "competing-recovery",
      }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "waiver_adjudication_active",
  );
});

test("started cancellation recovers undecided Requests without rewriting the cancelled attempt", (context) => {
  const { core, recoveries } = createFixture(context);
  core.run(
    `UPDATE codex_execution_queue
     SET worker_id = 'worker-1', fencing_token = 1,
         lease_expires_at = 100, started_at = 11
     WHERE work_id = 'adjudication-1'`,
  );
  core.run(
    `UPDATE waiver_adjudications
     SET execution_status = 'running', started_at = 11,
         codex_cli_version = '0.145.0'
     WHERE id = 'adjudication-1'`,
  );
  core.run(
    `UPDATE waiver_adjudications
     SET execution_status = 'cancelled', completed_at = 20
     WHERE id = 'adjudication-1'`,
  );

  const recovered = recoveries.recover({
    adjudicationId: "adjudication-1",
    channel: "browser_session",
    idempotencyKey: "recover-started-cancellation",
  });

  assert.equal(recovered.status, 201);
  assert.equal(recovered.resource.adjudication.id, "adjudication-2");
  assert.deepEqual(
    core.all(
      `SELECT id, execution_status, started_at, completed_at
       FROM waiver_adjudications ORDER BY rowid`,
    ),
    [
      {
        completed_at: 20,
        execution_status: "cancelled",
        id: "adjudication-1",
        started_at: 11,
      },
      {
        completed_at: null,
        execution_status: "queued",
        id: "adjudication-2",
        started_at: null,
      },
    ],
  );
});

test("waiver recovery is browser-only and hard gates run before mutation", (context) => {
  const { core } = createFixture(context);
  core.run(
    `INSERT INTO waiver_adjudication_pre_start_attempts (
       waiver_adjudication_id, retry_cycle, attempt_number,
       failed_at, error_code, error_detail, exhausted
     ) VALUES (
       'adjudication-1', 1, 1, 20, 'repository_permission_denied',
       'Repository permission is unavailable.', 1
     )`,
  );
  const forbidden = createWaiverAdjudicationRecoveryService(core, {
    createAdjudicationId: () => assert.fail("forbidden recovery created work"),
    now: () => 30,
    readCodexCapabilityFailure: () => null,
    storageReserve: { assertWorkAdmissionAvailable() {} },
  });
  assert.throws(
    () =>
      forbidden.recover({
        adjudicationId: "adjudication-1",
        channel: "implementer_token",
        idempotencyKey: "machine-recovery",
      }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "waiver_adjudication_recovery_forbidden",
  );

  const gated = createWaiverAdjudicationRecoveryService(core, {
    createAdjudicationId: () => assert.fail("gated recovery created work"),
    now: () => 30,
    readCodexCapabilityFailure: () =>
      Object.assign(new Error("Codex authentication is unavailable"), {
        code: "codex_authentication_failed",
        unavailable: true,
      }),
    storageReserve: { assertWorkAdmissionAvailable() {} },
  });
  assert.throws(
    () =>
      gated.recover({
        adjudicationId: "adjudication-1",
        channel: "browser_session",
        idempotencyKey: "gated-recovery",
      }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "codex_authentication_failed",
  );
  assert.equal(
    core.get(
      `SELECT retry_state FROM codex_execution_queue
       WHERE work_id = 'adjudication-1'`,
    )?.retry_state,
    "exhausted",
  );
});

test("same-identity recovery preserves accepted work after Repository disablement", (context) => {
  const { core, recoveries } = createFixture(context);
  core.run(
    `INSERT INTO waiver_adjudication_pre_start_attempts (
       waiver_adjudication_id, retry_cycle, attempt_number,
       failed_at, error_code, error_detail, exhausted
     ) VALUES (
       'adjudication-1', 1, 1, 20, 'repository_permission_denied',
       'Repository permission is unavailable.', 1
     )`,
  );
  core.run(
    `UPDATE repositories SET lifecycle = 'disabled'
     WHERE id = 'repository-1'`,
  );
  const recovered = recoveries.recover({
    adjudicationId: "adjudication-1",
    channel: "browser_session",
    idempotencyKey: "recover-disabled-repository",
  });
  assert.equal(recovered.resource.adjudication.id, "adjudication-1");
  assert.equal(recovered.status, 200);
});
