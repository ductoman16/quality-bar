import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createCodexExecutionClaimService } from "../src/codex-execution-claim.js";
import { recoverCodexExecutions } from "../src/codex-execution-recovery.js";
import { openDurableCore } from "../src/durable-core.js";
import { createReviewRunEvidenceService } from "../src/review-run-evidence.js";
import { createQueuedReviewRun } from "./review-run-claim-support.js";

test("restart terminates a tracked surviving process group and retains its partial transcript", async (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-process-recovery-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite"));
  context.after(() => core.close());
  await createQueuedReviewRun(core);
  const claims = createCodexExecutionClaimService(core, {
    createWorkerId: () => "interrupted-process-worker",
    now: () => 20,
  });
  const claim = claims.claimNext();
  assert.ok(claim);
  claims.start(claim, "0.145.0");
  createReviewRunEvidenceService(core).appendTranscriptChunk(
    claim,
    "stdout",
    '{"type":"item.completed","partial":true}\n',
  );

  const child = spawn(
    process.execPath,
    [join(import.meta.dirname, "../fixtures/test-probes/idle-child.mjs")],
    { detached: true, stdio: "ignore" },
  );
  assert.ok(child.pid);
  context.after(() => {
    try {
      process.kill(-(/** @type {number} */ (child.pid)), "SIGKILL");
    } catch (error) {
      if (
        !(
          error instanceof Error &&
          "code" in error &&
          String(error.code) === "ESRCH"
        )
      ) {
        throw error;
      }
    }
  });
  claims.trackProcessGroup(claim, child.pid);
  const exited = new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("tracked process group survived recovery")),
      2_000,
    );
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });

  recoverCodexExecutions(core, { now: () => 30 });
  await exited;

  assert.deepEqual(
    core.get(
      `SELECT process_group_id, recovery_termination_signal, recovered_at
       FROM codex_execution_queue WHERE work_id = 'review-run-1'`,
    ),
    {
      process_group_id: child.pid,
      recovered_at: 30,
      recovery_termination_signal: "SIGTERM",
    },
  );
  assert.deepEqual(
    core.all(
      `SELECT sequence, stream, content
       FROM review_run_transcript_chunks
       WHERE review_run_id = 'review-run-1'`,
    ),
    [
      {
        content: '{"type":"item.completed","partial":true}\n',
        sequence: 1,
        stream: "stdout",
      },
    ],
  );
  assert.equal(
    core.get("SELECT error_code FROM review_runs WHERE id = 'review-run-1'")
      ?.error_code,
    "unexpected_execution_failure",
  );
});
