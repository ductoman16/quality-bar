import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { createReviewRunClaimService } from "../src/review-run-claim.js";
import { createCodexExecutionConcurrencyService } from "../src/codex-execution-concurrency.js";
import {
  createQueuedReviewRun,
  createSiblingQueuedReviewRun,
} from "./review-run-claim-support.js";

test("oldest queued Review Run is claimed once and replacement increments its fencing token", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-claim-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  await createQueuedReviewRun(core);
  createSiblingQueuedReviewRun(core);
  createCodexExecutionConcurrencyService(core).set(2);
  core.run(
    "UPDATE codex_execution_queue SET ready_at = ? WHERE work_id = ?",
    300_000,
    "review-run-2",
  );

  let now = 1_000;
  const firstWorker = createReviewRunClaimService(core, {
    createWorkerId: () => "worker-1",
    now: () => now,
  });
  const firstClaim = firstWorker.claimNext();
  assert.ok(firstClaim);
  assert.deepEqual(firstClaim, {
    fencingToken: 1,
    leaseExpiresAt: 121_000,
    workerId: "worker-1",
    workId: "review-run-1",
    workKind: "review_run",
  });
  assert.deepEqual(
    core.get(
      `SELECT worker_id, fencing_token, lease_expires_at
       FROM codex_execution_queue WHERE work_id = ?`,
      "review-run-1",
    ),
    {
      fencing_token: 1,
      lease_expires_at: 121_000,
      worker_id: "worker-1",
    },
  );

  now = 31_000;
  assert.deepEqual(firstWorker.renew(firstClaim), {
    ...firstClaim,
    leaseExpiresAt: 151_000,
  });

  now = 151_000;
  const replacementWorker = createReviewRunClaimService(core, {
    createWorkerId: () => "worker-2",
    now: () => now,
  });
  const replacement = replacementWorker.claimNext();
  assert.deepEqual(replacement, {
    fencingToken: 2,
    leaseExpiresAt: 271_000,
    workerId: "worker-2",
    workId: "review-run-1",
    workKind: "review_run",
  });
  assert.throws(
    () => firstWorker.start(firstClaim, "0.145.0"),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "review_run_claim_lost" &&
      error.message === "Review Run claim is no longer authoritative",
  );
  replacementWorker.start(replacement, "0.145.0");
  assert.equal(replacementWorker.claimNext(), undefined);
  now = 300_000;
  assert.deepEqual(
    createReviewRunClaimService(core, {
      createWorkerId: () => "worker-3",
      now: () => now,
    }).claimNext(),
    {
      fencingToken: 1,
      leaseExpiresAt: 420_000,
      workerId: "worker-3",
      workId: "review-run-2",
      workKind: "review_run",
    },
  );
  assert.deepEqual(
    core.all(
      "SELECT id, execution_status FROM review_runs ORDER BY created_at, id",
    ),
    [
      { execution_status: "running", id: "review-run-1" },
      { execution_status: "queued", id: "review-run-2" },
    ],
  );
});
