import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable/durable-core.ts";
import { createEvaluationService } from "../src/evaluation/evaluation.ts";
import { createReviewService } from "../src/review/review.ts";

function runWorker(arguments_: string[]) {
  return new Promise<any>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["fixtures/test-probes/review-run-admission-worker.mjs", ...arguments_],
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
        reject(new Error(`admission worker failed: ${stderr.trim()}`));
        return;
      }
      resolve(JSON.parse(stdout));
    });
  });
}

test("separate processes preserve replay and cannot over-admit the final shared queue slot", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-admission-race-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const databasePath = join(directory, "quality-bar.sqlite3");
  const core = openDurableCore(databasePath);
  core.run(
    "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES (?, ?, ?, ?)",
    "repository-1",
    "https://example.invalid/repository.git",
    1,
    1,
  );
  let factId = 0;
  createReviewService(core, {
    createId: () => `review-fact-${++factId}`,
    now: () => 1,
  }).create({
    assignment: { scope: "installation_wide" },
    codex_configuration: {
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      service_tier: "standard",
    },
    criteria: [{ impact: "blocking", instruction: "Prove process admission." }],
    description: "Process integration proof",
    name: "Process boundary",
  });
  let evaluationId = 0;
  let reviewRunId = 0;
  const evaluations = createEvaluationService(core, {
    acquireChangeset: async () => ({
      base_commit: "1".repeat(40),
      head_commit: "2".repeat(40),
    }),
    createId: () => `existing-evaluation-${++evaluationId}`,
    createReviewRunId: () => `existing-review-run-${++reviewRunId}`,
    readCodexCapabilityFailure: () => null,
    masterKey: Buffer.alloc(32, 7),
    now: () => 10,
    storageReserve: { assertWorkAdmissionAvailable() {} },
  });
  for (let index = 1; index <= 24; index += 1) {
    await evaluations.createExplicit({
      channel: "implementer_token",
      idempotencyKey: `existing-${index}`,
      repositoryId: "repository-1",
      request: {
        base: { type: "branch", value: "main" },
        head: { type: "branch", value: "topic" },
      },
    });
  }
  core.close();

  const replayResults = [
    await runWorker([
      databasePath,
      "shared-racer",
      "shared-evaluation-a",
      "shared-review-run-a",
    ]),
    await runWorker([
      databasePath,
      "shared-racer",
      "shared-evaluation-b",
      "shared-review-run-b",
    ]),
  ];
  assert.deepEqual(
    replayResults.map((outcome) => outcome.outcome),
    ["accepted", "accepted"],
  );
  assert.equal(replayResults[0].id, replayResults[1].id);
  const afterReplay = openDurableCore(databasePath);
  afterReplay.run(
    `UPDATE codex_execution_queue
     SET started_at = 21
     WHERE work_id IN ('shared-review-run-a', 'shared-review-run-b')`,
  );
  afterReplay.close();

  const outcomes = await Promise.all([
    runWorker([databasePath, "request-a", "evaluation-a", "review-run-a"]),
    runWorker([databasePath, "request-b", "evaluation-b", "review-run-b"]),
  ]);
  assert.deepEqual(outcomes.map((outcome) => outcome.outcome).sort(), [
    "accepted",
    "rejected",
  ]);

  const reopened = openDurableCore(databasePath);
  assert.equal(
    reopened.get(
      "SELECT count(*) AS count FROM codex_execution_queue WHERE started_at IS NULL",
    )?.count,
    25,
  );
  assert.equal(
    reopened.get("SELECT count(*) AS count FROM evaluations")?.count,
    26,
  );
  assert.equal(
    reopened.get(
      "SELECT count(*) AS count FROM evaluation_idempotency WHERE idempotency_key IN ('request-a', 'request-b')",
    )?.count,
    1,
  );
  assert.equal(
    reopened.get(
      "SELECT count(*) AS count FROM evaluation_idempotency WHERE idempotency_key = 'shared-racer'",
    )?.count,
    1,
  );
  reopened.close();
});
