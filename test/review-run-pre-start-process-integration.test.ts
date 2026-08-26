import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openDurableCore } from "../src/durable/durable-core.ts";
import { recoverCodexExecutions } from "../src/codex/codex-execution-recovery.ts";
import { createQueuedReviewRun } from "./review-run-claim-support.ts";

function runAttempt(
  databasePath: string,
  attemptedAt: number,
  workerId: string,
) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "fixtures/test-probes/codex-pre-start-worker.mjs",
        databasePath,
        String(attemptedAt),
        workerId,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim()));
        return;
      }
      resolve(JSON.parse(stdout));
    });
  });
}

function crashDuringAttempt(databasePath: string) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "fixtures/test-probes/codex-pre-start-worker.mjs",
        databasePath,
        "20",
        "crashing-worker",
        "begin-and-crash",
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 17) {
        reject(new Error(stderr.trim() || `unexpected exit ${String(code)}`));
        return;
      }
      resolve(undefined);
    });
  });
}

test("separate workers resume the same accepted Review Run retry cycle from SQLite", async (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-run-retry-process-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const databasePath = join(directory, "quality-bar.sqlite");
  const core = openDurableCore(databasePath);
  await createQueuedReviewRun(core);
  core.close();

  assert.deepEqual(await runAttempt(databasePath, 20, "worker-1"), {
    attemptNumber: 1,
    exhausted: false,
    nextAttemptAt: 60_020,
    retryCycle: 1,
  });
  assert.deepEqual(await runAttempt(databasePath, 60_020, "worker-2"), {
    attemptNumber: 2,
    exhausted: false,
    nextAttemptAt: 360_020,
    retryCycle: 1,
  });
  assert.deepEqual(await runAttempt(databasePath, 360_020, "worker-3"), {
    attemptNumber: 3,
    exhausted: true,
    nextAttemptAt: null,
    retryCycle: 1,
  });

  const reopened = openDurableCore(databasePath);
  assert.equal(
    reopened.get(
      "SELECT count(*) AS count FROM review_run_pre_start_attempts WHERE review_run_id = 'review-run-1'",
    )?.count,
    3,
  );
  reopened.close();
});

test("a worker crash during checkout resumes from the remaining durable budget", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-run-retry-crash-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const databasePath = join(directory, "quality-bar.sqlite");
  const core = openDurableCore(databasePath);
  await createQueuedReviewRun(core);
  core.close();

  await crashDuringAttempt(databasePath);

  const recovered = openDurableCore(databasePath);
  recoverCodexExecutions(recovered, { now: () => 30 });
  assert.deepEqual(
    recovered.get(
      `SELECT attempt_number, error_code, exhausted
       FROM review_run_pre_start_attempts
       WHERE review_run_id = 'review-run-1'`,
    ),
    {
      attempt_number: 1,
      error_code: "codex_pre_start_interrupted",
      exhausted: 0,
    },
  );
  recovered.close();

  assert.deepEqual(await runAttempt(databasePath, 60_030, "worker-2"), {
    attemptNumber: 2,
    exhausted: false,
    nextAttemptAt: 360_030,
    retryCycle: 1,
  });
});
