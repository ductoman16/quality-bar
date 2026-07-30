import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { createEvaluationService } from "../src/evaluation.js";
import { createReviewRunClaimService } from "../src/review-run-claim.js";
import { createQueuedReviewRun } from "./review-run-claim-support.js";

/** @param {import("node:test").TestContext} context */
async function fixture(context) {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-pre-start-cancel-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite"));
  context.after(() => core.close());
  await createQueuedReviewRun(core);
  let now = 20;
  return {
    claims: createReviewRunClaimService(core, {
      createWorkerId: () => "pre-start-cancellation-worker",
      now: () => now,
    }),
    core,
    cancel() {
      now = 30;
      return createEvaluationService(core, {
        acquireChangeset: async () =>
          assert.fail("cancellation must not acquire"),
        masterKey: Buffer.alloc(32, 7),
        now: () => now,
        readCodexCapabilityFailure: () => null,
        storageReserve: { assertWorkAdmissionAvailable() {} },
      }).cancel("evaluation-1");
    },
  };
}

for (const [name, recordAttempt] of [
  ["an active checkout attempt", false],
  ["a delayed transient retry", true],
]) {
  test(`cancellation preserves pre-start history after ${name}`, async (context) => {
    const { cancel, claims, core } = await fixture(context);
    const claim = claims.claimNext();
    assert.ok(claim);
    if (recordAttempt) {
      claims.recordPreStartFailure(
        claim,
        Object.assign(new Error("Temporary checkout failure"), {
          code: "review_run_checkout_failed",
        }),
      );
    } else {
      claims.beginPreStartAttempt(claim);
    }

    assert.equal(cancel().execution_status, "cancelled");
    assert.equal(
      core.get("SELECT count(*) AS count FROM codex_execution_queue")?.count,
      0,
    );
    assert.equal(
      core.get(
        "SELECT count(*) AS count FROM codex_execution_pre_start_attempts",
      )?.count,
      1,
    );
  });
}
