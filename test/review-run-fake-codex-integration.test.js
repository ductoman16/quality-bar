import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { executeReviewRun } from "../src/review-run-execution.js";
import { openDurableCore } from "../src/durable-core.js";
import { createEvaluationService } from "../src/evaluation.js";
import { createReviewRunClaimService } from "../src/review-run-claim.js";
import { createReviewRunEvidenceService } from "../src/review-run-evidence.js";
import { createReviewRunResultService } from "../src/review-run-result.js";
import { createQueuedReviewRun } from "./review-run-claim-support.js";
import { fakeCodexScenarios } from "./review-run-fake-codex-scenarios.js";

const fakeCodexPath = fileURLToPath(
  new URL("../fixtures/test-probes/fake-codex-review-run.mjs", import.meta.url),
);

/** @param {import("node:test").TestContext} context @param {"clear" | "triggered" | "not_applicable" | "error" | "process_failure" | "evidence_failure" | "deadline" | "cancellation" | "inspect_on_demand"} outcome */
async function proveFakeCodexResult(context, outcome) {
  const scenario = fakeCodexScenarios[outcome];
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
  mkdirSync(join(source, "packages/shared"), { recursive: true });
  writeFileSync(
    join(source, "packages/shared/context.txt"),
    "surrounding monorepo context\n",
  );
  execFileSync("git", ["-C", source, "add", "AGENTS.md", "packages"]);
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
    applicabilityRule:
      'file_changes.exists(file, file.after_content.matches("triggered proof"))',
    baseCommit: commit,
    fileChanges: [
      {
        added: true,
        after_path: "reviewed.txt",
        before_path: null,
        deleted: false,
        id: "file-change-applicability",
        modified: false,
        renamed: false,
      },
    ],
    headCommit: head,
    matchesPath() {
      throw new Error("Content-only Applicability must not match paths");
    },
    readContent(fileChange, side) {
      assert.equal(fileChange.id, "file-change-applicability");
      return side === "before"
        ? { state: "absent" }
        : { state: "text", value: "triggered proof\n" };
    },
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
  /** @type {() => void} */
  let signalDeadline = () => assert.fail("deadline timer was not installed");
  /** @type {() => void} */
  let forceKill = () => assert.fail("termination timer was not installed");
  let deadlineSubmissionOutcome = "missing";
  let cancellationSubmissionOutcome = "missing";
  const deadlineEvidence = {
    /** @param {any} evidenceClaim @param {"stdout" | "stderr"} stream @param {string} content */
    appendTranscriptChunk(evidenceClaim, stream, content) {
      durableEvidence.appendTranscriptChunk(evidenceClaim, stream, content);
      if (content.includes('"type":"fake.deadline_ready"')) {
        queueMicrotask(signalDeadline);
      }
      if (content.includes('"type":"fake.deadline_submission_rejected"')) {
        deadlineSubmissionOutcome = "rejected";
        queueMicrotask(forceKill);
      }
      if (content.includes('"type":"fake.deadline_submission_accepted"')) {
        deadlineSubmissionOutcome = "accepted";
        queueMicrotask(forceKill);
      }
    },
    complete: durableEvidence.complete.bind(durableEvidence),
  };
  const cancellationService = createEvaluationService(core, {
    acquireChangeset: async () => {
      throw new Error("unused cancellation acquisition");
    },
    masterKey: Buffer.alloc(32, 7),
    now: () => 25,
    readCodexCapabilityFailure: () => null,
    storageReserve: { assertWorkAdmissionAvailable() {} },
  });
  const cancellationEvidence = {
    /** @param {any} evidenceClaim @param {"stdout" | "stderr"} stream @param {string} content */
    appendTranscriptChunk(evidenceClaim, stream, content) {
      durableEvidence.appendTranscriptChunk(evidenceClaim, stream, content);
      if (content.includes('"type":"fake.cancellation_ready"')) {
        queueMicrotask(() => cancellationService.cancel("evaluation-1"));
      }
      if (content.includes('"type":"fake.cancellation_submission_rejected"')) {
        cancellationSubmissionOutcome = "rejected";
        queueMicrotask(forceKill);
      }
      if (content.includes('"type":"fake.cancellation_submission_accepted"')) {
        cancellationSubmissionOutcome = "accepted";
        queueMicrotask(forceKill);
      }
    },
    complete: durableEvidence.complete.bind(durableEvidence),
  };

  const execution = () =>
    executeReviewRun(core, claim, {
      checkoutRoot,
      claimService: claims,
      codexCommand: process.execPath,
      codexPrefixArguments: [fakeCodexPath, ...scenario.arguments],
      evidenceService: scenario.createEvidenceService({
        cancellationEvidence,
        deadlineEvidence,
        durableEvidence,
        evidenceFailure,
      }),
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
      ...scenario.createTimerOptions({
        /** @param {() => void} callback */
        setForceKill(callback) {
          forceKill = callback;
        },
        /** @param {() => void} callback */
        setSignalDeadline(callback) {
          signalDeadline = callback;
        },
      }),
    });
  await scenario.execute(execution);

  assert.equal(existsSync(join(checkoutRoot, claim.workId, "1")), false);
  if (scenario.verifySpecialResult) {
    scenario.verifySpecialResult({
      claim,
      core,
      cancellationSubmissionOutcome,
      deadlineSubmissionOutcome,
    });
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
      outcome: scenario.evaluationOutcome,
    },
  );
  assert.deepEqual(
    core.get(`SELECT outcome, error_code, error_detail FROM criterion_results`),
    {
      error_code: scenario.criterionErrorCode,
      error_detail: scenario.criterionErrorDetail,
      outcome: outcome === "inspect_on_demand" ? "clear" : outcome,
    },
  );
  const persistedFinding = core.get(
    `SELECT id, evidence, remediation, location_kind, side
     FROM findings`,
  );
  if (scenario.finding) {
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

test("one pinned fake Codex run inspects unchanged monorepo context on demand without host-selected content", async (context) => {
  await proveFakeCodexResult(context, "inspect_on_demand");
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

test(
  "one overdue fake Codex run closes submission and force-kills its process group without a partial Result",
  { timeout: 10_000 },
  async (context) => {
    await proveFakeCodexResult(context, "deadline");
  },
);

test(
  "operator cancellation commits before signaling fake Codex and rejects its in-flight submission",
  { timeout: 10_000 },
  async (context) => {
    await proveFakeCodexResult(context, "cancellation");
  },
);
