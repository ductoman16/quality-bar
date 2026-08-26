import { createIoExecutionPool } from "../src/io-execution-pool.ts";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { openDurableCore } from "../src/durable/durable-core.ts";
import { createEvaluationService } from "../src/evaluation/evaluation.ts";
import { executeReviewRun } from "../src/review/review-run-execution.ts";
import { createReviewRunClaimService } from "../src/review/review-run-claim.ts";
import { createReviewRunResultService } from "../src/review/review-run-result.ts";
import { createReviewService } from "../src/review/review.ts";
import { createQueuedReviewRun } from "./review-run-claim-support.ts";

const fakeCodexPath = fileURLToPath(
  new URL("../fixtures/test-probes/fake-codex-review-run.mjs", import.meta.url),
);

test("multiple independent fake Codex runs share one frozen Git Changeset and publish once", async (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-multiple-fake-codex-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  const source = join(directory, "source");
  execFileSync("git", ["init", "--initial-branch=main", source], {
    stdio: "ignore",
  });
  writeFileSync(join(source, "base.txt"), "frozen base\n");
  execFileSync("git", ["-C", source, "add", "base.txt"]);
  execFileSync(
    "git",
    [
      "-C",
      source,
      "-c",
      "user.name=Quality Bar",
      "-c",
      "user.email=quality-bar@example.invalid",
      "commit",
      "-m",
      "frozen base",
    ],
    { stdio: "ignore" },
  );
  const base = execFileSync("git", ["-C", source, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  writeFileSync(join(source, "reviewed.txt"), "triggered proof\n");
  execFileSync("git", ["-C", source, "add", "reviewed.txt"]);
  execFileSync(
    "git",
    [
      "-C",
      source,
      "-c",
      "user.name=Quality Bar",
      "-c",
      "user.email=quality-bar@example.invalid",
      "commit",
      "-m",
      "frozen head",
    ],
    { stdio: "ignore" },
  );
  const head = execFileSync("git", ["-C", source, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  await createQueuedReviewRun(core, {
    baseCommit: base,
    headCommit: head,
    repositoryUrl: source,
    reviewCount: 2,
  });
  const checkoutRoot = join(directory, "checkouts");
  const executions: [number, string[]][] = [
    [1, [fakeCodexPath, "--fake-triggered"]],
    [2, [fakeCodexPath, "--fake-correction"]],
  ];
  for (const [index, arguments_] of executions) {
    const claims = createReviewRunClaimService(core, {
      createWorkerId: () => `multiple-worker-${index}`,
      now: () => index * 20,
    });
    const claim = claims.claimNext();
    assert.ok(claim);
    await executeReviewRun(core, claim, {
      ioPool: createIoExecutionPool(),
      checkoutRoot,
      claimService: claims,
      codexCommand: process.execPath,
      codexPrefixArguments: arguments_,
      resultService: createReviewRunResultService(core, {
        createFindingId: () => `multiple-finding-${index}`,
        now: () => index * 20 + 10,
      }),
    });
    assert.equal(
      core.get(
        "SELECT count(*) AS count FROM evaluation_results WHERE evaluation_id = 'evaluation-1'",
      )?.count,
      index === 1 ? 0 : 1,
    );
  }
  assert.deepEqual(
    core.get(
      `SELECT evaluations.execution_status, evaluation_results.outcome
       FROM evaluations
       JOIN evaluation_results
         ON evaluation_results.evaluation_id = evaluations.id
       WHERE evaluations.id = 'evaluation-1'`,
    ),
    { execution_status: "completed", outcome: "blocking" },
  );
  assert.equal(core.get("SELECT count(*) AS count FROM review_runs")?.count, 2);
  assert.equal(
    core.get("SELECT count(*) AS count FROM criterion_results")?.count,
    2,
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM evaluation_file_changes")?.count,
    1,
  );
});

test("intentional same-Changeset reruns launch distinct fake Codex work and Results", async (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-rerun-fake-codex-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  const source = join(directory, "source");
  execFileSync("git", ["init", "--initial-branch=main", source], {
    stdio: "ignore",
  });
  writeFileSync(join(source, "base.txt"), "frozen base\n");
  execFileSync("git", ["-C", source, "add", "base.txt"]);
  execFileSync(
    "git",
    [
      "-C",
      source,
      "-c",
      "user.name=Quality Bar",
      "-c",
      "user.email=quality-bar@example.invalid",
      "commit",
      "-m",
      "frozen base",
    ],
    { stdio: "ignore" },
  );
  const base = execFileSync("git", ["-C", source, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  writeFileSync(join(source, "reviewed.txt"), "triggered proof\n");
  execFileSync("git", ["-C", source, "add", "reviewed.txt"]);
  execFileSync(
    "git",
    [
      "-C",
      source,
      "-c",
      "user.name=Quality Bar",
      "-c",
      "user.email=quality-bar@example.invalid",
      "commit",
      "-m",
      "frozen head",
    ],
    { stdio: "ignore" },
  );
  const head = execFileSync("git", ["-C", source, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  core.run(
    "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES (?, ?, ?, ?)",
    "repository-rerun",
    source,
    1,
    1,
  );
  let reviewFact = 0;
  createReviewService(core, {
    createId: () => `fake-rerun-review-fact-${++reviewFact}`,
    now: () => 1,
  }).create({
    assignment: { scope: "installation_wide" },
    codex_configuration: {
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      service_tier: "standard",
    },
    criteria: [
      {
        impact: "blocking",
        instruction: "Review the frozen Changeset.",
      },
    ],
    description: "Intentional rerun fake Codex proof.",
    name: "Intentional rerun fake Codex",
  });
  let evaluationId = 0;
  let reviewRunId = 0;
  const evaluations = createEvaluationService(core, {
    acquireChangeset: async () => ({
      base_commit: base,
      head_commit: head,
    }),
    createId: () => `fake-rerun-evaluation-${++evaluationId}`,
    createReviewRunId: () => `fake-rerun-review-run-${++reviewRunId}`,
    readCodexCapabilityFailure: () => null,
    masterKey: Buffer.alloc(32, 7),
    now: () => 10,
    storageReserve: { assertWorkAdmissionAvailable() {} },
  });
  const input = {
    channel: "implementer_token" as "implementer_token",
    repositoryId: "repository-rerun",
    request: {
      base: { type: "commit", value: base },
      head: { type: "commit", value: head },
    },
  };
  await evaluations.createExplicit({
    ...input,
    idempotencyKey: "fake-rerun-key-1",
  });
  await evaluations.createExplicit({
    ...input,
    idempotencyKey: "fake-rerun-key-2",
  });

  const checkoutRoot = join(directory, "checkouts");
  for (let index = 1; index <= 2; index += 1) {
    const claims = createReviewRunClaimService(core, {
      createWorkerId: () => `fake-rerun-worker-${index}`,
      now: () => index * 20,
    });
    const claim = claims.claimNext();
    assert.ok(claim);
    await executeReviewRun(core, claim, {
      ioPool: createIoExecutionPool(),
      checkoutRoot,
      claimService: claims,
      codexCommand: process.execPath,
      codexPrefixArguments: [fakeCodexPath, "--fake-correction"],
      resultService: createReviewRunResultService(core, {
        createFindingId: () => `unused-finding-${index}`,
        now: () => index * 20 + 10,
      }),
    });
  }

  assert.deepEqual(
    core.all(
      `SELECT evaluations.id, evaluations.base_commit,
              evaluations.head_commit, evaluation_results.outcome
       FROM evaluations
       JOIN evaluation_results
         ON evaluation_results.evaluation_id = evaluations.id
       ORDER BY evaluations.id`,
    ),
    [1, 2].map((index) => ({
      base_commit: base,
      head_commit: head,
      id: `fake-rerun-evaluation-${index}`,
      outcome: "clear",
    })),
  );
  assert.equal(core.get("SELECT count(*) AS count FROM review_runs")?.count, 2);
  assert.equal(
    core.get("SELECT count(*) AS count FROM criterion_results")?.count,
    2,
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM evaluation_file_changes")?.count,
    2,
  );
  assert.equal(
    core.get(
      "SELECT count(DISTINCT review_run_id) AS count FROM review_run_transcript_chunks",
    )?.count,
    2,
  );
});
