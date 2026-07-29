import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

/** @param {import("node:test").TestContext} context @param {"clear" | "triggered" | "not_applicable" | "error"} outcome */
async function proveFakeCodexResult(context, outcome) {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-fake-codex-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  const source = join(directory, "source");
  execFileSync("git", ["init", "--initial-branch=main", source], {
    stdio: "ignore",
  });
  writeFileSync(
    join(source, "AGENTS.md"),
    "obey this Repository instruction\n",
  );
  execFileSync("git", ["-C", source, "add", "AGENTS.md"]);
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
  const commit = execFileSync("git", ["-C", source, "rev-parse", "HEAD"], {
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
    baseCommit: commit,
    headCommit: head,
    repositoryUrl: source,
  });
  const claims = createReviewRunClaimService(core, {
    createWorkerId: () => "fake-codex-worker",
    now: () => 20,
  });
  const claim = claims.claimNext();
  assert.ok(claim);
  const checkoutRoot = join(directory, "checkouts");
  const results = createReviewRunResultService(core, {
    createFindingId: () => "finding-fake-codex",
    now: () => 30,
  });

  await executeReviewRun(core, claim, {
    checkoutRoot,
    claimService: claims,
    codexCommand: process.execPath,
    codexPrefixArguments:
      outcome === "triggered"
        ? [fakeCodexPath, "--fake-triggered"]
        : outcome === "not_applicable"
          ? [fakeCodexPath, "--fake-not-applicable"]
          : outcome === "error"
            ? [fakeCodexPath, "--fake-error"]
            : [fakeCodexPath, "--fake-correction"],
    processEnvironment: {
      CODEX_HOME: "/var/lib/quality-bar/codex",
      HOME: "/var/lib/quality-bar",
      LANG: "C.UTF-8",
      PATH: "/usr/local/bin:/usr/bin",
      QUALITY_BAR_FORGE_TOKEN: "forge-owned-secret",
      QUALITY_BAR_GIT_TOKEN: "git-owned-secret",
      QUALITY_BAR_IMPLEMENTER_TOKEN: "implementer-owned-secret",
      QUALITY_BAR_MASTER_KEY: "master-key-owned-secret",
      QUALITY_BAR_OPERATOR_PASSWORD: "operator-owned-secret",
      QUALITY_BAR_SESSION_SECRET: "session-owned-secret",
      QUALITY_BAR_CSRF_SECRET: "csrf-owned-secret",
    },
    resultService: results,
  });

  assert.equal(existsSync(join(checkoutRoot, claim.workId, "1")), false);
  assert.deepEqual(
    core.get(
      `SELECT evaluations.execution_status, evaluation_results.outcome
       FROM evaluations
       JOIN evaluation_results
         ON evaluation_results.evaluation_id = evaluations.id
       WHERE evaluations.id = 'evaluation-1'`,
    ),
    {
      execution_status: "completed",
      outcome:
        outcome === "error"
          ? "error"
          : outcome === "triggered"
            ? "blocking"
            : "clear",
    },
  );
  assert.deepEqual(
    core.get(`SELECT outcome, error_code, error_detail FROM criterion_results`),
    {
      error_code: outcome === "error" ? "required_evidence_unavailable" : null,
      error_detail:
        outcome === "error"
          ? "The required generated file is absent from the head."
          : null,
      outcome,
    },
  );
  const persistedFinding = core.get(
    `SELECT id, evidence, remediation, location_kind, side
     FROM findings`,
  );
  if (outcome === "triggered") {
    assert.deepEqual(persistedFinding, {
      evidence: "The changed file contains the triggered proof.",
      id: "finding-fake-codex",
      location_kind: "whole_side",
      remediation: "Replace the triggered proof.",
      side: "head",
    });
  } else {
    assert.equal(persistedFinding, undefined);
  }
}

test("one pinned fake Codex run reaches a clear Result only through quality-bar-submit", async (context) => {
  await proveFakeCodexResult(context, "clear");
});

test("one pinned fake Codex run submits an honest triggered Finding only through quality-bar-submit", async (context) => {
  await proveFakeCodexResult(context, "triggered");
});

test("one pinned fake Codex run preserves a successful not-applicable fact", async (context) => {
  await proveFakeCodexResult(context, "not_applicable");
});

test("one pinned fake Codex run preserves an exact Criterion error without a Finding", async (context) => {
  await proveFakeCodexResult(context, "error");
});
