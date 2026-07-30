import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { executeClaimWithOwningAdapter } from "../src/codex-execution-dispatch.js";
import { createCodexExecutionClaimService } from "../src/codex-execution-claim.js";
import { createIoExecutionPool } from "../src/io-execution-pool.js";
import { runReviewRunCodex as runProductionReviewRunCodex } from "../src/review-run-codex-adapter.js";
import { seedQueuedCodexExecutionKinds } from "./codex-execution-ordering-support.js";
import {
  acceptedChannel,
  claim as adapterClaim,
  run as adapterRun,
  runReviewRunCodex,
  runningProcess,
} from "./review-run-codex-adapter-support.js";

test("process-group tracking is required before opening submission", async () => {
  let opened = false;
  await assert.rejects(
    () =>
      runProductionReviewRunCodex(
        /** @type {any} */ ({
          checkoutPath: "/checkout",
          claim: adapterClaim,
          openSubmissionChannel: async () => {
            opened = true;
            return acceptedChannel();
          },
          recordDeadline() {},
          resultService: { prepare() {} },
          run: adapterRun,
        }),
      ),
    new TypeError("Codex process-group tracking dependencies are invalid"),
  );
  assert.equal(opened, false);
});

test("the owning fake Codex adapter is reached only after the shared durable claim commits", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-claim-adapter-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const databasePath = join(directory, "quality-bar.sqlite3");
  const core = openDurableCore(databasePath);
  context.after(() => core.close());
  seedQueuedCodexExecutionKinds(core, {
    adjudicationReadyAt: 10,
    reviewRunReadyAt: 20,
  });
  const claims = createCodexExecutionClaimService(core, {
    createWorkerId: () => "fake-codex-worker",
    now: () => 20,
  });
  /** @type {{claim: {workId: string}, durableClaim: Record<string, import("node:sqlite").SQLInputValue> | undefined}[]} */
  const launches = [];
  let reviewRunLaunches = 0;

  /** @param {{workId: string}} claim */
  function launchFakeCodex(claim) {
    const observer = openDurableCore(databasePath);
    try {
      launches.push({
        claim,
        durableClaim: observer.get(
          `SELECT worker_id, fencing_token, lease_expires_at
           FROM codex_execution_queue WHERE work_id = ?`,
          claim.workId,
        ),
      });
    } finally {
      observer.close();
    }
  }

  const claim = claims.claimNext();
  assert.ok(claim);
  assert.equal(claim.workKind, "waiver_adjudication");
  claims.start(claim, "0.145.0");
  executeClaimWithOwningAdapter(claim, {
    executeReviewRun() {
      reviewRunLaunches += 1;
    },
    executeWaiverAdjudication: launchFakeCodex,
  });
  assert.deepEqual(launches, [
    {
      claim,
      durableClaim: {
        fencing_token: 1,
        lease_expires_at: 120_020,
        worker_id: "fake-codex-worker",
      },
    },
  ]);
  assert.equal(launches.length, 1);
  assert.equal(reviewRunLaunches, 0);
  assert.equal(
    core.get("SELECT count(*) AS count FROM waiver_decisions")?.count,
    0,
  );
  assert.deepEqual(
    core.get(
      `SELECT waiver_adjudications.execution_status,
              codex_execution_queue.started_at
       FROM waiver_adjudications
       JOIN codex_execution_queue
         ON codex_execution_queue.work_id = waiver_adjudications.id
       WHERE waiver_adjudications.id = ?`,
      claim.workId,
    ),
    { execution_status: "running", started_at: 20 },
  );
  assert.equal(
    core.get(
      "SELECT execution_status FROM review_runs WHERE id = 'review-run-z'",
    )?.execution_status,
    "queued",
  );
});

test("a long owning Codex adapter cannot starve an independent I/O duty", async () => {
  /** @type {(value?: void) => void} */
  let finishCodex = () => {};
  const codexFinished = new Promise((resolve) => {
    finishCodex = resolve;
  });
  const codexStarted = executeClaimWithOwningAdapter(
    {
      fencingToken: 1,
      leaseExpiresAt: 120_000,
      workerId: "worker-1",
      workId: "review-run-1",
      workKind: "review_run",
    },
    {
      executeReviewRun: () => codexFinished,
      executeWaiverAdjudication() {
        assert.fail("the non-owning adapter must not run");
      },
    },
  );
  let polled = false;
  await createIoExecutionPool().run("polling", async () => {
    polled = true;
  });
  assert.equal(polled, true);
  finishCodex();
  await codexStarted;
});

test("the Codex adapter tracks the detached process group before observing its terminal result", async () => {
  const child = runningProcess(4321);
  /** @type {string[]} */
  const events = [];

  await runReviewRunCodex({
    checkoutPath: "/checkout",
    claim: adapterClaim,
    evidenceService: {
      appendTranscriptChunk() {},
      complete() {},
    },
    finishProcessGroup() {
      events.push("finish");
    },
    killProcessGroup(processGroupId, signal) {
      assert.equal(processGroupId, -4321);
      if (signal === "SIGTERM") {
        events.push("terminate");
        queueMicrotask(() => child.emit("close", 0, null));
        return;
      }
      if (signal === 0) {
        throw Object.assign(new Error("process group exited"), {
          code: "ESRCH",
        });
      }
    },
    openSubmissionChannel: async () => acceptedChannel(),
    resultService: { prepare() {} },
    run: adapterRun,
    spawnProcess() {
      events.push("spawn");
      return /** @type {any} */ (child);
    },
    trackProcessGroup(processGroupId) {
      assert.equal(processGroupId, 4321);
      events.push("track");
    },
  });

  assert.deepEqual(events, ["spawn", "track", "terminate", "finish"]);
});
