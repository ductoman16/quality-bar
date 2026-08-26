import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openDurableCore } from "../src/durable/durable-core.ts";
import { createWaiverAdjudicationRecoveryService } from "../src/waiver/waiver-adjudication-recovery.ts";
import { createWaiverAdjudicationResultService } from "../src/waiver/waiver-adjudication-result-service.ts";
import { createWaiverBatchService } from "../src/waiver/waiver-batch.ts";
import { seedCompletedEvaluation } from "./support/waiver-batch-fixture.ts";

function createFixture(context: import("node:test").TestContext) {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-recovery-lineage-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite"));
  context.after(() => core.close());
  seedCompletedEvaluation(core);
  const adjudicationIds = ["adjudication-1", "adjudication-2"];
  createWaiverBatchService(core, {
    createAdjudicationId: () =>
      adjudicationIds.shift() ?? assert.fail("missing Adjudication identity"),
    createRequestId: () => "request-1",
    now: () => 10,
    readCodexCapabilityFailure: () => null,
    storageReserve: { assertWorkAdmissionAvailable() {} },
  }).submit({
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
  return { core, recoveries };
}

test("a recovered Decision error makes its failed predecessor stale", (context) => {
  const { core, recoveries } = createFixture(context);
  core.run(
    `UPDATE codex_execution_queue SET started_at = 11
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
    idempotencyKey: "recover-failed-source",
  });
  core.run(
    `UPDATE codex_execution_queue
     SET worker_id = 'worker-2', fencing_token = 1,
         lease_expires_at = 100, started_at = 31
     WHERE work_id = 'adjudication-2'`,
  );
  core.run(
    `UPDATE waiver_adjudications
     SET execution_status = 'running', started_at = 31,
         codex_cli_version = '0.145.0'
     WHERE id = 'adjudication-2'`,
  );
  createWaiverAdjudicationResultService(core, {
    createDecisionId: () => "decision-error",
    now: () => 32,
  }).prepare(
    {
      fencingToken: 1,
      workerId: "worker-2",
      workId: "adjudication-2",
    },
    {
      decisions: [
        {
          error: {
            code: "evidence_unavailable",
            detail: "Required evidence is unavailable.",
          },
          outcome: "error",
          request_id: "request-1",
        },
      ],
    },
  );
  assert.throws(
    () =>
      recoveries.recover({
        adjudicationId: "adjudication-1",
        channel: "browser_session",
        idempotencyKey: "recover-stale-source",
      }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "waiver_adjudication_recovery_conflict",
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM waiver_adjudications")?.count,
    2,
  );
});

test("same-identity recovery rejects its obsolete frozen configuration", (context) => {
  const { core, recoveries } = createFixture(context);
  core.run(
    `INSERT INTO waiver_adjudication_pre_start_attempts (
       waiver_adjudication_id, retry_cycle, attempt_number,
       failed_at, error_code, error_detail, exhausted
     ) VALUES (
       'adjudication-1', 1, 1, 20, 'codex_model_unsupported',
       'Codex model is unsupported.', 1
     )`,
  );
  const immutableTrigger = core.get(
    `SELECT sql FROM sqlite_schema
     WHERE type = 'trigger'
       AND name = 'waiver_adjudication_identity_immutable'`,
  )?.sql;
  assert.equal(typeof immutableTrigger, "string");
  core.run("DROP TRIGGER waiver_adjudication_identity_immutable");
  core.run(
    `UPDATE waiver_adjudications SET model = 'obsolete-model'
     WHERE id = 'adjudication-1'`,
  );
  core.run(immutableTrigger as string);
  assert.throws(
    () =>
      recoveries.recover({
        adjudicationId: "adjudication-1",
        channel: "browser_session",
        idempotencyKey: "recover-obsolete-configuration",
      }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "codex_model_unsupported",
  );
  assert.equal(
    core.get(
      `SELECT retry_state
       FROM codex_execution_queue WHERE work_id = 'adjudication-1'`,
    )?.retry_state,
    "exhausted",
  );
});
