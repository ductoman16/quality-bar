import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
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
