import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { executeReviewRun } from "../src/review-run-execution.js";
import { createReviewRunClaimService } from "../src/review-run-claim.js";
import { createReviewRunResultService } from "../src/review-run-result.js";
import { createQueuedReviewRun } from "./review-run-claim-support.js";

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
  writeFileSync(join(source, "reviewed.txt"), "clear proof\n");
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
  /** @type {[number, string[]][]} */
  const executions = [
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
