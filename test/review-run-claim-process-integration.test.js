import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable/durable-core.js";
import { seedQueuedCodexExecutionKinds } from "./codex-execution-ordering-support.js";

/** @param {string[]} arguments_ */
function runWorker(arguments_) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["fixtures/test-probes/review-run-claim-worker.mjs", ...arguments_],
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
        reject(new Error(`claim worker failed: ${stderr.trim()}`));
        return;
      }
      resolve(JSON.parse(stdout));
    });
  });
}

test("separate processes share ordering and fence an expired worker across work kinds", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-claim-race-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const databasePath = join(directory, "quality-bar.sqlite3");
  const core = openDurableCore(databasePath);
  seedQueuedCodexExecutionKinds(core, {
    adjudicationReadyAt: 1_000,
    reviewRunReadyAt: 300_000,
  });
  core.close();

  const racers = await Promise.all([
    runWorker([databasePath, "claim", "worker-a", "1000"]),
    runWorker([databasePath, "claim", "worker-b", "1000"]),
  ]);
  const claimed = racers.find((result) => result.claim !== null)?.claim;
  assert.ok(claimed);
  assert.equal(racers.filter((result) => result.claim !== null).length, 1);
  assert.equal(claimed.fencingToken, 1);
  assert.equal(claimed.workId, "adjudication-a");
  assert.equal(claimed.workKind, "waiver_adjudication");

  const replacement = await runWorker([
    databasePath,
    "claim",
    "worker-replacement",
    "121000",
  ]);
  assert.equal(replacement.claim.fencingToken, 2);

  assert.deepEqual(
    await runWorker([
      databasePath,
      "start",
      claimed.workerId,
      "121000",
      claimed.workId,
      claimed.workKind,
      String(claimed.fencingToken),
    ]),
    { code: "waiver_adjudication_claim_lost", outcome: "rejected" },
  );
  assert.deepEqual(
    await runWorker([
      databasePath,
      "start",
      replacement.claim.workerId,
      "121000",
      replacement.claim.workId,
      replacement.claim.workKind,
      String(replacement.claim.fencingToken),
    ]),
    { outcome: "started" },
  );
});

test("separate processes cannot claim beyond the durable concurrency setting", async (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-concurrency-race-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const databasePath = join(directory, "quality-bar.sqlite3");
  const core = openDurableCore(databasePath);
  seedQueuedCodexExecutionKinds(core, {
    adjudicationReadyAt: 1_000,
    reviewRunReadyAt: 1_000,
  });
  core.close();

  const racers = await Promise.all([
    runWorker([databasePath, "claim", "worker-a", "1000"]),
    runWorker([databasePath, "claim", "worker-b", "1000"]),
  ]);
  assert.equal(racers.filter((result) => result.claim !== null).length, 1);

  const setting = await runWorker([
    databasePath,
    "set-concurrency",
    "worker-setting",
    "1000",
    "2",
  ]);
  assert.deepEqual(setting, { maximumRunning: 2 });
  const second = await runWorker([databasePath, "claim", "worker-c", "1000"]);
  assert.ok(second.claim);

  assert.deepEqual(
    await runWorker([
      databasePath,
      "set-concurrency",
      "worker-setting",
      "1001",
      "1",
    ]),
    { maximumRunning: 1 },
  );
  const firstClaim = racers.find((result) => result.claim !== null).claim;
  assert.deepEqual(
    await runWorker([
      databasePath,
      "start",
      firstClaim.workerId,
      "1001",
      firstClaim.workId,
      firstClaim.workKind,
      String(firstClaim.fencingToken),
    ]),
    { outcome: "started" },
  );
  assert.deepEqual(
    await runWorker([
      databasePath,
      "start",
      second.claim.workerId,
      "1001",
      second.claim.workId,
      second.claim.workKind,
      String(second.claim.fencingToken),
    ]),
    {
      code: "codex_execution_concurrency_unavailable",
      outcome: "rejected",
    },
  );
  const verified = openDurableCore(databasePath);
  assert.equal(
    verified.get(
      "SELECT count(*) AS count FROM codex_execution_queue WHERE started_at IS NOT NULL",
    )?.count,
    1,
  );
  assert.equal(
    verified.get(
      "SELECT lease_expires_at FROM codex_execution_queue WHERE work_id = ?",
      second.claim.workId,
    )?.lease_expires_at,
    1_001,
  );
  verified.close();
});

test("a replacement Review Run claim fences the expired process before launch", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-review-race-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const databasePath = join(directory, "quality-bar.sqlite3");
  const core = openDurableCore(databasePath);
  seedQueuedCodexExecutionKinds(core, {
    adjudicationReadyAt: 300_000,
    reviewRunReadyAt: 1_000,
  });
  core.close();

  const first = await runWorker([databasePath, "claim", "review-old", "1000"]);
  assert.equal(first.claim.workId, "review-run-z");
  assert.equal(first.claim.workKind, "review_run");
  const replacement = await runWorker([
    databasePath,
    "claim",
    "review-new",
    "121000",
  ]);
  assert.equal(replacement.claim.fencingToken, 2);
  assert.deepEqual(
    await runWorker([
      databasePath,
      "start",
      first.claim.workerId,
      "121000",
      first.claim.workId,
      first.claim.workKind,
      String(first.claim.fencingToken),
    ]),
    { code: "review_run_claim_lost", outcome: "rejected" },
  );
  assert.deepEqual(
    await runWorker([
      databasePath,
      "start",
      replacement.claim.workerId,
      "121000",
      replacement.claim.workId,
      replacement.claim.workKind,
      String(replacement.claim.fencingToken),
    ]),
    { outcome: "started" },
  );
});
