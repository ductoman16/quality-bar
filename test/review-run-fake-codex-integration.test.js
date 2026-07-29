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
import { createReviewRunEvidenceService } from "../src/review-run-evidence.js";
import { createReviewRunResultService } from "../src/review-run-result.js";
import { createQueuedReviewRun } from "./review-run-claim-support.js";

const fakeCodexPath = fileURLToPath(
  new URL("../fixtures/test-probes/fake-codex-review-run.mjs", import.meta.url),
);

/** @param {import("node:test").TestContext} context @param {"clear" | "triggered" | "not_applicable" | "error" | "process_failure" | "evidence_failure" | "deadline"} outcome */
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
  const durableEvidence = createReviewRunEvidenceService(core);
  const evidenceFailure = Object.assign(
    new Error("SQLite durable evidence write failed"),
    { code: "storage_unavailable" },
  );

  const execution = () =>
    executeReviewRun(core, claim, {
      checkoutRoot,
      claimService: claims,
      codexCommand: process.execPath,
      codexPrefixArguments:
        outcome === "deadline"
          ? [fakeCodexPath, "--fake-deadline"]
          : outcome === "process_failure"
            ? [fakeCodexPath, "--fake-process-failure"]
            : outcome === "triggered"
              ? [fakeCodexPath, "--fake-triggered"]
              : outcome === "not_applicable"
                ? [fakeCodexPath, "--fake-not-applicable"]
                : outcome === "error"
                  ? [fakeCodexPath, "--fake-error"]
                  : [fakeCodexPath, "--fake-correction"],
      evidenceService:
        outcome === "evidence_failure"
          ? {
              appendTranscriptChunk:
                durableEvidence.appendTranscriptChunk.bind(durableEvidence),
              complete() {
                throw evidenceFailure;
              },
            }
          : durableEvidence,
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
      ...(outcome === "deadline"
        ? {
            /** @param {() => void} callback @param {number} milliseconds */
            setDeadlineTimer(callback, milliseconds) {
              assert.equal(milliseconds, 15 * 60 * 1_000);
              return setTimeout(callback, 100);
            },
            /** @param {() => void} callback @param {number} milliseconds */
            setTerminationTimer(callback, milliseconds) {
              assert.equal(milliseconds, 5_000);
              return setTimeout(callback, 20);
            },
          }
        : {}),
    });
  if (
    outcome === "process_failure" ||
    outcome === "evidence_failure" ||
    outcome === "deadline"
  ) {
    await assert.rejects(
      execution,
      (error) =>
        error instanceof Error &&
        "code" in error &&
        error.code ===
          (outcome === "process_failure"
            ? "codex_process_failed"
            : outcome === "deadline"
              ? "deadline_exceeded"
              : "storage_unavailable"),
    );
  } else {
    await execution();
  }

  assert.equal(existsSync(join(checkoutRoot, claim.workId, "1")), false);
  if (outcome === "deadline") {
    assert.deepEqual(
      core.get(
        `SELECT execution_status, error_code, error_detail,
                process_exit_code, process_signal,
                execution_evidence_recorded
         FROM review_runs WHERE id = ?`,
        claim.workId,
      ),
      {
        error_code: "deadline_exceeded",
        error_detail: "Codex Review Run exceeded its 15-minute deadline",
        execution_evidence_recorded: 1,
        execution_status: "failed",
        process_exit_code: null,
        process_signal: "SIGKILL",
      },
    );
    assert.equal(
      core.get("SELECT count(*) AS count FROM criterion_results")?.count,
      0,
    );
    assert.equal(core.get("SELECT count(*) AS count FROM findings")?.count, 0);
    return;
  }
  if (outcome === "process_failure") {
    assert.deepEqual(
      core.get(
        `SELECT execution_status, process_exit_code, process_signal,
                execution_evidence_recorded
         FROM review_runs WHERE id = ?`,
        claim.workId,
      ),
      {
        execution_evidence_recorded: 1,
        execution_status: "failed",
        process_exit_code: 1,
        process_signal: null,
      },
    );
    assert.ok(
      Number(
        core.get(
          `SELECT count(*) AS count
           FROM review_run_transcript_chunks
           WHERE review_run_id = ?`,
          claim.workId,
        )?.count,
      ) >= 2,
    );
    return;
  }
  if (outcome === "evidence_failure") {
    assert.deepEqual(
      core.get(
        `SELECT review_runs.execution_status,
                review_runs.execution_evidence_recorded,
                evaluations.execution_status,
                evaluation_results.outcome,
                criterion_results.outcome AS criterion_outcome
         FROM review_runs
         JOIN evaluations
           ON evaluations.id = review_runs.evaluation_id
         JOIN evaluation_results
           ON evaluation_results.evaluation_id = evaluations.id
         JOIN criterion_results
           ON criterion_results.review_run_id = review_runs.id
         WHERE review_runs.id = ?`,
        claim.workId,
      ),
      {
        criterion_outcome: "clear",
        execution_evidence_recorded: 0,
        execution_status: "completed",
        outcome: "clear",
      },
    );
    return;
  }
  assert.deepEqual(
    core.get(
      `SELECT codex_cli_version, started_at, completed_at,
              completed_at - started_at AS duration_ms,
              process_exit_code, process_signal,
              input_tokens, cached_input_tokens, output_tokens
       FROM review_runs WHERE id = ?`,
      claim.workId,
    ),
    {
      cached_input_tokens: 45,
      codex_cli_version: "0.145.0",
      completed_at: 30,
      duration_ms: 10,
      input_tokens: 120,
      output_tokens: 30,
      process_exit_code: null,
      process_signal: "SIGTERM",
      started_at: 20,
    },
  );
  const transcriptChunks = core.all(
    `SELECT sequence, stream, content
     FROM review_run_transcript_chunks
     WHERE review_run_id = ?
     ORDER BY sequence`,
    claim.workId,
  );
  assert.ok(transcriptChunks.length >= 2);
  assert.deepEqual(
    transcriptChunks.map((row) => row?.sequence),
    Array.from(transcriptChunks.keys(), (index) => index + 1),
  );
  const stdout = transcriptChunks
    .filter((row) => row?.stream === "stdout")
    .map((row) => row?.content)
    .join("");
  const stderr = transcriptChunks
    .filter((row) => row?.stream === "stderr")
    .map((row) => row?.content)
    .join("");
  assert.match(stdout, /item\.completed/);
  assert.match(stdout, /turn\.completed/);
  assert.equal(stderr, "fake Codex diagnostic\n");
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

test("one failed fake Codex run durably retains transcript and process evidence", async (context) => {
  await proveFakeCodexResult(context, "process_failure");
});

test("post-acceptance evidence failure cannot overturn the complete Result", async (context) => {
  await proveFakeCodexResult(context, "evidence_failure");
});

test("one overdue fake Codex run closes submission and force-kills its process group without a partial Result", async (context) => {
  await proveFakeCodexResult(context, "deadline");
});
