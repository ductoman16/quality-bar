import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

import { openDurableCore } from "../src/durable-core.js";
import { executeClaimWithOwningAdapter } from "../src/codex-execution-dispatch.js";
import { createCodexExecutionClaimService } from "../src/codex-execution-claim.js";
import { startSpawnedCodexProcessGroup } from "../src/codex-execution-process-group-tracking.js";
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

test("tracking failure still terminates the untracked detached process group", async () => {
  const trackingFailure = new Error("durable tracking failed");
  const closeFailure = new Error("submission close failed");
  const terminationFailure = new Error("termination failed");
  /** @type {string[]} */
  const events = [];
  await assert.rejects(
    () =>
      startSpawnedCodexProcessGroup(
        /** @type {any} */ ({ pid: 4321 }),
        () => {
          throw trackingFailure;
        },
        () => {
          assert.fail("submission provenance bound after failed tracking");
        },
        async () => {
          assert.fail("Codex launched before durable tracking");
        },
        async () => {
          events.push("close");
          throw closeFailure;
        },
        async () => {
          events.push("terminate");
          throw terminationFailure;
        },
        () => {
          assert.fail("unstarted tracking was finished");
        },
      ),
    trackingFailure,
  );
  assert.deepEqual(events, ["close", "terminate"]);
  assert.equal(
    /** @type {any} */ (trackingFailure).submissionCloseFailure,
    closeFailure,
  );
  assert.equal(
    /** @type {any} */ (trackingFailure).terminationFailure,
    terminationFailure,
  );
});

test("submission provenance binds before launch and a binding failure finishes tracked process state", async () => {
  const bindingFailure = new Error("trusted process publication failed");
  /** @type {string[]} */
  const events = [];
  await assert.rejects(
    () =>
      startSpawnedCodexProcessGroup(
        /** @type {any} */ ({ pid: 4322 }),
        () => {
          events.push("track");
        },
        () => {
          events.push("bind");
          throw bindingFailure;
        },
        async () => {
          events.push("launch");
        },
        async () => {
          events.push("close");
        },
        async () => {
          events.push("terminate");
        },
        () => {
          events.push("finish");
        },
      ),
    bindingFailure,
  );
  assert.deepEqual(events, ["track", "bind", "close", "terminate", "finish"]);
});

test("a termination failure retains tracked provenance for recovery", async () => {
  const bindingFailure = new Error("trusted process publication failed");
  const terminationFailure = new Error("process group termination failed");
  let finishes = 0;
  await assert.rejects(
    () =>
      startSpawnedCodexProcessGroup(
        /** @type {any} */ ({ pid: 4324 }),
        () => {},
        () => {
          throw bindingFailure;
        },
        async () => {
          assert.fail("Codex launched after provenance binding failed");
        },
        async () => {},
        async () => {
          throw terminationFailure;
        },
        () => {
          finishes += 1;
        },
      ),
    (error) => {
      assert.equal(error, bindingFailure);
      assert.equal(
        /** @type {any} */ (error).terminationFailure,
        terminationFailure,
      );
      return true;
    },
  );
  assert.equal(finishes, 0);
});

test("a falsy termination failure retains tracked provenance for recovery", async () => {
  const bindingFailure = new Error("trusted process publication failed");
  let finishes = 0;
  await assert.rejects(
    () =>
      startSpawnedCodexProcessGroup(
        /** @type {any} */ ({ pid: 4325 }),
        () => {},
        () => {
          throw bindingFailure;
        },
        async () => {
          assert.fail("Codex launched after provenance binding failed");
        },
        async () => {},
        async () => {
          runInNewContext("throw undefined");
        },
        () => {
          finishes += 1;
        },
      ),
    (error) => {
      assert.equal(error, bindingFailure);
      assert.match(
        /** @type {any} */ (error).terminationFailure.message,
        /process-group termination failed/u,
      );
      return true;
    },
  );
  assert.equal(finishes, 0);
});

test("the Codex adapter fences launch and terminates its supervisor when provenance binding fails", async () => {
  const bindingFailure = new Error("trusted process publication failed");
  const child = runningProcess(4323);
  /** @type {string[]} */
  const events = [];
  await assert.rejects(
    () =>
      runReviewRunCodex({
        checkoutPath: "/checkout",
        claim: adapterClaim,
        finishProcessGroup() {
          events.push("finish");
        },
        killProcessGroup(processGroupId, signal) {
          assert.equal(processGroupId, -4323);
          if (signal === "SIGTERM") {
            events.push("terminate");
            queueMicrotask(() => child.emit("close", null, "SIGTERM"));
            return;
          }
          assert.equal(signal, 0);
          throw Object.assign(new Error("process group exited"), {
            code: "ESRCH",
          });
        },
        openSubmissionChannel: async () => ({
          ...acceptedChannel(),
          bindProcessGroup() {
            events.push("bind");
            throw bindingFailure;
          },
        }),
        prepareProcess() {
          return {
            async abort() {},
            child: /** @type {any} */ (child),
            async finish() {},
            async start() {
              events.push("launch");
            },
          };
        },
        resultService: { prepare() {} },
        run: adapterRun,
        trackProcessGroup(processGroupId) {
          assert.equal(processGroupId, 4323);
          events.push("track");
        },
      }),
    bindingFailure,
  );
  assert.deepEqual(events, ["track", "bind", "terminate", "finish"]);
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

test("only the replacement Review Run claim reaches its owning adapter", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-adapter-race-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  seedQueuedCodexExecutionKinds(core, {
    adjudicationReadyAt: 300_000,
    reviewRunReadyAt: 10,
  });
  let now = 10;
  let worker = 0;
  const claims = createCodexExecutionClaimService(core, {
    createWorkerId: () => `adapter-worker-${++worker}`,
    now: () => now,
  });
  const expired = claims.claimNext();
  assert.ok(expired);
  assert.equal(expired.workKind, "review_run");
  now = 120_010;
  const replacement = claims.claimNext();
  assert.ok(replacement);
  assert.equal(replacement.fencingToken, 2);
  assert.throws(
    () => claims.start(expired, "0.145.0"),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "review_run_claim_lost",
  );
  claims.start(replacement, "0.145.0");
  let reviewLaunches = 0;
  executeClaimWithOwningAdapter(replacement, {
    executeReviewRun(claim) {
      reviewLaunches += 1;
      assert.deepEqual(claim, replacement);
    },
    executeWaiverAdjudication() {
      assert.fail(
        "stale Review Run must not reach the Waiver Adjudication adapter",
      );
    },
  });
  assert.equal(reviewLaunches, 1);
});
