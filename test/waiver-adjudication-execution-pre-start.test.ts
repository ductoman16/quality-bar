import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openDurableCore } from "../src/durable/durable-core.ts";
import { createIoExecutionPool } from "../src/io-execution-pool.ts";
import { createWaiverAdjudicationClaimService } from "../src/waiver/waiver-adjudication-claim.ts";
import { executeWaiverAdjudication } from "../src/waiver/waiver-adjudication-execution.ts";
import { createWaiverBatchService } from "../src/waiver/waiver-batch.ts";
import { seedCompletedEvaluation } from "./support/waiver-batch-fixture.ts";

function createFixture(context: import("node:test").TestContext) {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-waiver-execution-pre-start-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite"));
  context.after(() => core.close());
  seedCompletedEvaluation(core);
  createWaiverBatchService(core, {
    createAdjudicationId: () => "adjudication-1",
    createRequestId: () => "request-1",
    now: () => 20,
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
  return core;
}

test("a queued Waiver Adjudication acquisition shutdown releases without consuming an attempt", async (context) => {
  const core = createFixture(context);
  const claims = createWaiverAdjudicationClaimService(core, {
    createWorkerId: () => "shutdown-worker",
    now: () => 20,
  });
  const claim = claims.claimNext();
  assert.ok(claim);
  const ioPool = createIoExecutionPool();
  const blockers = Promise.withResolvers();
  const occupied = Array.from({ length: 3 }, () =>
    ioPool.run("polling", () => blockers.promise),
  );
  await new Promise((resolve) => setImmediate(resolve));
  const execution = executeWaiverAdjudication(core, claim, {
    claimService: claims,
    evidenceService: {},
    ioPool,
    prepareCheckout: () => assert.fail("queued acquisition entered checkout"),
    resultService: {},
    runCodex: () => assert.fail("queued acquisition launched Codex"),
  });
  const shutdownFailure = Object.assign(new Error("Durable storage failed"), {
    code: "durable_storage_failed",
  });
  ioPool.shutdown(shutdownFailure);
  await assert.rejects(
    execution,
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "durable_storage_failed",
  );
  blockers.resolve(undefined);
  await Promise.allSettled(occupied);
  assert.deepEqual(
    core.get(
      `SELECT lease_expires_at, retry_state
       FROM codex_execution_queue WHERE work_id = 'adjudication-1'`,
    ),
    { lease_expires_at: 20, retry_state: "ready" },
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM codex_execution_pre_start_attempts")
      ?.count,
    0,
  );
});
