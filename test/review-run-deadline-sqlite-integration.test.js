import { createIoExecutionPool } from "../src/io-execution-pool.js";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable/durable-core.js";
import { executeReviewRun } from "../src/review/review-run-execution.js";
import { createReviewRunClaimService } from "../src/review/review-run-claim.js";
import {
  createReviewRunResultService,
  ReviewRunExecutionError,
} from "../src/review/review-run-result.js";
import { createQueuedReviewRun } from "./review-run-claim-support.js";

test("the Review Run deadline persists one exact terminal failure and no partial Result facts", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-deadline-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  await createQueuedReviewRun(core);
  const claims = createReviewRunClaimService(core, {
    createWorkerId: () => "deadline-worker",
    now: () => 20,
  });
  const claim = claims.claimNext();
  assert.ok(claim);
  const failure = new ReviewRunExecutionError(
    "deadline_exceeded",
    "Codex Review Run exceeded its 15-minute deadline",
  );

  await assert.rejects(
    () =>
      executeReviewRun(core, claim, {
        ioPool: createIoExecutionPool(),
        claimService: claims,
        prepareCheckout: async () => ({
          path: "/discarded-checkout",
          remove() {},
        }),
        readFileChanges: () => [],
        resultService: createReviewRunResultService(core, { now: () => 30 }),
        async runCodex(input) {
          input.startProcessGroup?.(process.pid);
          input.recordDeadline?.(failure);
          assert.deepEqual(
            core.get(
              `SELECT execution_status, error_code FROM review_runs
               WHERE id = ?`,
              claim.workId,
            ),
            {
              error_code: "deadline_exceeded",
              execution_status: "failed",
            },
          );
          throw failure;
        },
      }),
    (error) => error === failure,
  );
  assert.deepEqual(
    core.get(
      `SELECT execution_status, error_code, error_detail
       FROM review_runs`,
    ),
    {
      error_code: "deadline_exceeded",
      error_detail: "Codex Review Run exceeded its 15-minute deadline",
      execution_status: "failed",
    },
  );
  assert.deepEqual(
    core.get(
      `SELECT evaluations.execution_status, evaluation_results.outcome
       FROM evaluations
       JOIN evaluation_results
         ON evaluation_results.evaluation_id = evaluations.id`,
    ),
    { execution_status: "completed", outcome: "error" },
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM criterion_results")?.count,
    0,
  );
  assert.equal(core.get("SELECT count(*) AS count FROM findings")?.count, 0);
});
