import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { createReviewRunClaimService } from "../src/review-run-claim.js";
import { createQueuedReviewRun } from "./review-run-claim-support.js";

test("the fake Codex adapter is reached only after its durable claim commits", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-claim-adapter-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const databasePath = join(directory, "quality-bar.sqlite3");
  const core = openDurableCore(databasePath);
  context.after(() => core.close());
  await createQueuedReviewRun(core);
  const claims = createReviewRunClaimService(core, {
    createWorkerId: () => "fake-codex-worker",
    now: () => 1_000,
  });
  /** @type {{claim: {workId: string}, durableClaim: Record<string, import("node:sqlite").SQLInputValue> | undefined}[]} */
  const launches = [];

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
  claims.start(claim);
  launchFakeCodex(claim);
  assert.deepEqual(launches, [
    {
      claim,
      durableClaim: {
        fencing_token: 1,
        lease_expires_at: 121_000,
        worker_id: "fake-codex-worker",
      },
    },
  ]);
  assert.equal(claims.claimNext(), undefined);
  assert.equal(launches.length, 1);
  assert.equal(
    core.get("SELECT count(*) AS count FROM evaluation_results")?.count,
    0,
  );
  assert.deepEqual(
    core.get(
      `SELECT review_runs.execution_status, codex_execution_queue.started_at
       FROM review_runs
       JOIN codex_execution_queue
         ON codex_execution_queue.work_id = review_runs.id
       WHERE review_runs.id = ?`,
      claim.workId,
    ),
    { execution_status: "running", started_at: 1_000 },
  );
});
