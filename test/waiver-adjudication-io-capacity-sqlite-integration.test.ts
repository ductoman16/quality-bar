import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openDurableCore } from "../src/durable/durable-core.ts";
import {
  IO_EXECUTION_CONCURRENCY,
  IO_EXECUTION_QUEUE_CAPACITY,
  createIoExecutionPool,
} from "../src/io-execution-pool.ts";
import { createWaiverAdjudicationClaimService } from "../src/waiver/waiver-adjudication-claim.ts";
import { executeWaiverAdjudication } from "../src/waiver/waiver-adjudication-execution.ts";
import { createWaiverBatchService } from "../src/waiver/waiver-batch.ts";
import { seedCompletedEvaluation } from "./support/waiver-batch-fixture.ts";

test("I/O saturation releases waiver work without consuming a pre-start attempt", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-waiver-io-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite"));
  context.after(() => core.close());
  seedCompletedEvaluation(core);
  createWaiverBatchService(core, {
    createAdjudicationId: () => "adjudication-1",
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
  let currentTime = 20;
  let worker = 0;
  const claims = createWaiverAdjudicationClaimService(core, {
    createWorkerId: () => `capacity-worker-${++worker}`,
    now: () => currentTime,
  });
  const ioPool = createIoExecutionPool({
    reportBackgroundFailure() {
      assert.fail("Unexpected background I/O failure");
    },
  });
  context.after(() => ioPool.close());
  const releases: ((value?: void) => void)[] = [];
  const active = Array.from({ length: IO_EXECUTION_CONCURRENCY - 1 }, () =>
    ioPool.run(
      "acquisition",
      () => new Promise((resolve) => releases.push(resolve)),
    ),
  );
  await new Promise((resolve) => setImmediate(resolve));
  const queued = Array.from({ length: IO_EXECUTION_QUEUE_CAPACITY }, () =>
    ioPool.run("cleanup", () => {}),
  );

  const saturatedClaim = claims.claimNext();
  assert.ok(saturatedClaim);
  await assert.rejects(
    () =>
      executeWaiverAdjudication(core, saturatedClaim, {
        claimService: claims,
        evidenceService: {},
        ioPool,
        prepareCheckout: () =>
          assert.fail("Checkout began without I/O capacity"),
        resultService: {},
        runCodex: () => assert.fail("Codex launched without I/O capacity"),
      }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "io_execution_capacity_unavailable",
  );
  assert.equal(
    core.get(
      `SELECT count(*) AS count
       FROM waiver_adjudication_pre_start_attempts`,
    )?.count,
    0,
  );

  releases.splice(0).forEach((release) => release());
  await Promise.all([...active, ...queued]);
  currentTime = 21;
  const retryClaim = claims.claimNext();
  assert.ok(retryClaim);
  assert.equal(retryClaim.workId, saturatedClaim.workId);
  let launched = false;
  await executeWaiverAdjudication(core, retryClaim, {
    claimService: claims,
    evidenceService: {},
    ioPool,
    prepareCheckout: async () => ({ path: "/checkout", remove() {} }),
    resultService: {},
    async runCodex({
      startProcessGroup,
    }: {
      startProcessGroup: (processGroupId: number) => void;
    }) {
      startProcessGroup(process.pid);
      launched = true;
    },
  });
  assert.equal(launched, true);
  assert.deepEqual(
    core.get(
      `SELECT execution_status, retry_state
       FROM waiver_adjudications
       JOIN codex_execution_queue
         ON codex_execution_queue.work_id = waiver_adjudications.id
       WHERE waiver_adjudications.id = 'adjudication-1'`,
    ),
    { execution_status: "running", retry_state: "ready" },
  );
  assert.equal(
    core.get(
      `SELECT count(*) AS count
       FROM waiver_adjudication_pre_start_attempts`,
    )?.count,
    0,
  );
});
