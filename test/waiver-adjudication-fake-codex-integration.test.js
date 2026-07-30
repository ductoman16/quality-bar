import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { createWaiverAdjudicationClaimService } from "../src/waiver-adjudication-claim.js";
import { createWaiverAdjudicationEvidenceService } from "../src/waiver-adjudication-evidence.js";
import { executeWaiverAdjudication } from "../src/waiver-adjudication-execution.js";
import { createWaiverAdjudicationResultService } from "../src/waiver-adjudication-result-service.js";
import { createWaiverBatchService } from "../src/waiver-batch.js";
import { seedCompletedEvaluation } from "./support/waiver-batch-fixture.js";

const fakeCodex = fileURLToPath(
  new URL(
    "../fixtures/test-probes/fake-codex-waiver-adjudication.mjs",
    import.meta.url,
  ),
);

/** @param {string} repository @param {string} message */
function commit(repository, message) {
  execFileSync("git", ["-C", repository, "add", "."]);
  execFileSync(
    "git",
    [
      "-C",
      repository,
      "-c",
      "user.name=Quality Bar",
      "-c",
      "user.email=quality-bar@example.invalid",
      "commit",
      "-m",
      message,
    ],
    { stdio: "ignore" },
  );
  return execFileSync("git", ["-C", repository, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
}

/** @param {import("node:test").TestContext} context @param {boolean} failProcess */
async function runFocusedAdjudication(context, failProcess) {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-waiver-codex-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const repository = join(directory, "repository");
  execFileSync("git", ["init", "--initial-branch=main", repository], {
    stdio: "ignore",
  });
  writeFileSync(
    join(repository, "AGENTS.md"),
    "obey this Repository instruction\n",
  );
  const baseCommit = commit(repository, "frozen base");
  writeFileSync(join(repository, "reviewed.txt"), "frozen waiver evidence\n");
  const headCommit = commit(repository, "frozen head");
  const core = openDurableCore(join(directory, "quality-bar.sqlite"));
  context.after(() => core.close());
  seedCompletedEvaluation(core, {
    baseCommit,
    headCommit,
    repositoryUrl: repository,
  });
  core.run(
    `INSERT INTO findings (
       id, evaluation_id, review_run_id, criterion_id,
       evidence, remediation, location_kind
     ) VALUES (
       'finding-unselected', 'evaluation-1', 'run-1', 'criterion-1',
       'unselected evidence', 'unselected remediation', 'changeset'
     )`,
  );
  const requestIds = ["request-1", "request-2"];
  createWaiverBatchService(core, {
    createAdjudicationId: () => "adjudication-1",
    createRequestId: () => requestIds.shift() ?? assert.fail("missing id"),
    now: () => 10,
    readCodexCapabilityFailure: () => null,
    storageReserve: { assertWorkAdmissionAvailable() {} },
  }).submit({
    channel: "browser_session",
    evaluationId: "evaluation-1",
    idempotencyKey: "waiver-key",
    request: {
      requests: [
        { finding_id: "finding-1", rationale: "Exact first exception." },
        { finding_id: "finding-2", rationale: "Exact second exception." },
      ],
    },
  });
  const claims = createWaiverAdjudicationClaimService(core, {
    createWorkerId: () => "waiver-worker",
    now: () => 20,
  });
  const claim = claims.claimNext();
  assert.ok(claim);
  const decisionIds = ["decision-1", "decision-2"];
  const results = createWaiverAdjudicationResultService(core, {
    createDecisionId: () => decisionIds.shift() ?? assert.fail("missing id"),
    now: () => 30,
  });
  const checkoutRoot = join(directory, "checkouts");
  const execution = executeWaiverAdjudication(core, claim, {
    checkoutRoot,
    claimService: claims,
    codexCommand: process.execPath,
    codexPrefixArguments: [
      fakeCodex,
      ...(failProcess ? ["--fake-process-failure"] : []),
    ],
    evidenceService: createWaiverAdjudicationEvidenceService(core),
    processEnvironment: {
      CODEX_HOME: "/var/lib/quality-bar/codex",
      HOME: "/var/lib/quality-bar",
      LANG: "C.UTF-8",
      PATH: "/usr/local/bin:/usr/bin",
      QUALITY_BAR_MASTER_KEY: "excluded-owned-secret",
    },
    resultService: results,
  });
  if (failProcess) {
    await assert.rejects(
      execution,
      (error) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "result_not_submitted" &&
        error.message.includes("Waiver Adjudication"),
    );
  } else {
    await execution;
  }
  assert.equal(existsSync(join(checkoutRoot, claim.workId, "1")), false);
  return { claim, core };
}

test("one focused fake Codex process accepts only the first complete Decision set", async (context) => {
  const { claim, core } = await runFocusedAdjudication(context, false);
  assert.deepEqual(
    core.all(
      `SELECT waiver_request_id, outcome, explanation
       FROM waiver_decisions ORDER BY id`,
    ),
    [
      {
        explanation: "The exact first exception is justified.",
        outcome: "accepted",
        waiver_request_id: "request-1",
      },
      {
        explanation: "The exact second rationale is insufficient.",
        outcome: "denied",
        waiver_request_id: "request-2",
      },
    ],
  );
  assert.deepEqual(
    core.get(
      `SELECT execution_status, error_code, codex_cli_version,
              process_exit_code, process_signal,
              input_tokens, cached_input_tokens, output_tokens
       FROM waiver_adjudications WHERE id = ?`,
      claim.workId,
    ),
    {
      cached_input_tokens: 12,
      codex_cli_version: "0.145.0",
      error_code: null,
      execution_status: "completed",
      input_tokens: 80,
      output_tokens: 20,
      process_exit_code: null,
      process_signal: "SIGTERM",
    },
  );
  const transcript = core
    .all(
      `SELECT stream, content
       FROM waiver_adjudication_transcript_chunks
       WHERE waiver_adjudication_id = ? ORDER BY sequence`,
      claim.workId,
    )
    .map((/** @type {any} */ { stream, content }) => `${stream}:${content}`)
    .join("");
  assert.match(transcript, /item\.completed/);
  assert.match(transcript, /fake Waiver Adjudication diagnostic/);
});

test("a started fake Codex failure stores the exact owning failure and no Decision", async (context) => {
  const { core } = await runFocusedAdjudication(context, true);
  assert.equal(
    core.get("SELECT count(*) AS count FROM waiver_decisions")?.count,
    0,
  );
  assert.deepEqual(
    core.get(
      `SELECT execution_status, error_code, error_detail
       FROM waiver_adjudications WHERE id = 'adjudication-1'`,
    ),
    {
      error_code: "result_not_submitted",
      error_detail:
        "Codex Waiver Adjudication exited without an accepted Decision set; last validation error waiver_adjudication_submission_invalid: Waiver Adjudication submission must contain exactly one complete Decision per selected Request",
      execution_status: "failed",
    },
  );
});
