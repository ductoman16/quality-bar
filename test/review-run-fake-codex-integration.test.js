import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { executeReviewRun } from "../src/review-run-execution.js";
import { openDurableCore } from "../src/durable-core.js";
import { createReviewRunClaimService } from "../src/review-run-claim.js";
import { createReviewRunResultService } from "../src/review-run-result.js";
import { createQueuedReviewRun } from "./review-run-claim-support.js";

const fakeCodexPath = fileURLToPath(
  new URL("../fixtures/test-probes/fake-codex-review-run.mjs", import.meta.url),
);

test("one pinned fake Codex run reaches a clear Result only through quality-bar-submit", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-fake-codex-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  await createQueuedReviewRun(core);
  const claims = createReviewRunClaimService(core, {
    createWorkerId: () => "fake-codex-worker",
    now: () => 20,
  });
  const claim = claims.claimNext();
  assert.ok(claim);
  const checkout = join(directory, "checkout");
  /** @type {{state: unknown, type: string}[]} */
  const events = [];
  const results = createReviewRunResultService(core, { now: () => 30 });

  await executeReviewRun(core, claim, {
    claimService: claims,
    codexCommand: process.execPath,
    codexPrefixArguments: [fakeCodexPath],
    prepareCheckout: async () => {
      events.push({
        state: core.get(
          "SELECT execution_status FROM review_runs WHERE id = ?",
          claim.workId,
        )?.execution_status,
        type: "checkout",
      });
      mkdirSync(checkout);
      return { path: checkout, remove() {} };
    },
    resultService: results,
  });

  assert.deepEqual(events, [{ state: "queued", type: "checkout" }]);
  assert.deepEqual(
    core.get(
      `SELECT evaluations.execution_status, evaluation_results.outcome
       FROM evaluations
       JOIN evaluation_results
         ON evaluation_results.evaluation_id = evaluations.id
       WHERE evaluations.id = 'evaluation-1'`,
    ),
    { execution_status: "completed", outcome: "clear" },
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM criterion_results")?.count,
    1,
  );
});
