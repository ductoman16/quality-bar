import { createIoExecutionPool } from "../src/io-execution-pool.js";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { createEvaluationCollectionReader } from "../src/evaluation-collection-reader.js";
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
  core.transaction((/** @type {any} */ transaction) => {
    transaction.run(
      `INSERT INTO reviews (
         id, name, description, archived_at, active_version_id,
         hard_delete_pending, created_at
       ) VALUES (
         'review-2', 'Second Review', 'Second description', NULL,
         'version-2', 0, 1
       )`,
    );
    transaction.run(
      `INSERT INTO review_versions (
         id, review_id, number, applicability_rule, model,
         reasoning_effort, service_tier, created_at, sealed_at
       ) VALUES (
         'version-2', 'review-2', 1, NULL, 'gpt-5.6-terra',
         'high', 'standard', 1, NULL
       )`,
    );
    transaction.run(
      `INSERT INTO criteria (
         id, review_id, instruction, impact, created_at
       ) VALUES (
         'criterion-3', 'review-2', 'criterion-3', 'advisory', 1
       )`,
    );
    transaction.run(
      `INSERT INTO review_version_criteria (
         review_version_id, criterion_id, position, instruction, impact
       ) VALUES (
         'version-2', 'criterion-3', 1, 'criterion-3', 'advisory'
       )`,
    );
    transaction.run(
      "UPDATE review_versions SET sealed_at = 1 WHERE id = 'version-2'",
    );
    transaction.run(
      `INSERT INTO review_runs (
         id, evaluation_id, review_id, review_version_id, execution_status,
         started_at, completed_at, execution_evidence_recorded, created_at
       ) VALUES (
         'run-2', 'evaluation-1', 'review-2', 'version-2', 'running',
         1, NULL, 1, 1
       )`,
    );
    transaction.run(
      `INSERT INTO criterion_results (
         review_run_id, criterion_id, outcome
       ) VALUES ('run-2', 'criterion-3', 'triggered')`,
    );
    transaction.run(
      `INSERT INTO findings (
         id, evaluation_id, review_run_id, criterion_id,
         evidence, remediation, location_kind
       ) VALUES (
         'finding-3', 'evaluation-1', 'run-2', 'criterion-3',
         'third evidence', 'third remediation', 'changeset'
       )`,
    );
    transaction.run(
      `UPDATE review_runs
       SET execution_status = 'completed', completed_at = 2
       WHERE id = 'run-2'`,
    );
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
  const requestIds = ["request-1", "request-2", "request-3"];
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
        { finding_id: "finding-3", rationale: "Exact third exception." },
      ],
    },
  });
  const claims = createWaiverAdjudicationClaimService(core, {
    createWorkerId: () => "waiver-worker",
    now: () => 20,
  });
  const claim = claims.claimNext();
  assert.ok(claim);
  const decisionIds = ["decision-1", "decision-2", "decision-3"];
  const results = createWaiverAdjudicationResultService(core, {
    createDecisionId: () => decisionIds.shift() ?? assert.fail("missing id"),
    now: () => 30,
  });
  const checkoutRoot = join(directory, "checkouts");
  const execution = executeWaiverAdjudication(core, claim, {
    ioPool: createIoExecutionPool(),
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
  return { checkoutRoot, claim, core };
}

test("one focused fake Codex process atomically persists a mixed valid Decision set", async (context) => {
  const { checkoutRoot, claim, core } = await runFocusedAdjudication(
    context,
    false,
  );
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
      {
        explanation: null,
        outcome: "error",
        waiver_request_id: "request-3",
      },
    ],
  );
  assert.deepEqual(
    core.get(
      `SELECT error_code, error_detail
       FROM waiver_decisions WHERE waiver_request_id = 'request-3'`,
    ),
    {
      error_code: "required_evidence_unavailable",
      error_detail: "The frozen generated file cannot be inspected.",
    },
  );
  assert.equal(
    createEvaluationCollectionReader(core, Buffer.alloc(32, 7)).read(
      "evaluation-1",
    ).effective_outcome,
    "error",
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

  createWaiverBatchService(core, {
    createAdjudicationId: () => "adjudication-retry",
    createRequestId: () => assert.fail("error retry created a Request"),
    now: () => 40,
    readCodexCapabilityFailure: () => null,
    storageReserve: { assertWorkAdmissionAvailable() {} },
  }).retryErrors({
    channel: "browser_session",
    evaluationId: "evaluation-1",
    idempotencyKey: "error-retry",
    request: { request_ids: ["request-3"] },
  });
  const retryClaims = createWaiverAdjudicationClaimService(core, {
    createWorkerId: () => "waiver-retry-worker",
    now: () => 41,
  });
  const retryClaim = retryClaims.claimNext();
  assert.ok(retryClaim);
  await executeWaiverAdjudication(core, retryClaim, {
    ioPool: createIoExecutionPool(),
    checkoutRoot,
    claimService: retryClaims,
    codexCommand: process.execPath,
    codexPrefixArguments: [fakeCodex, "--fake-error-retry"],
    evidenceService: createWaiverAdjudicationEvidenceService(core),
    processEnvironment: {
      CODEX_HOME: "/var/lib/quality-bar/codex",
      HOME: "/var/lib/quality-bar",
      LANG: "C.UTF-8",
      PATH: "/usr/local/bin:/usr/bin",
    },
    resultService: createWaiverAdjudicationResultService(core, {
      createDecisionId: () => "decision-retry-accepted",
      now: () => 42,
    }),
  });
  assert.equal(
    core.get("SELECT count(*) AS count FROM waiver_requests")?.count,
    3,
  );
  assert.deepEqual(
    core.all(
      `SELECT waiver_decisions.outcome
       FROM waiver_decisions
       JOIN waiver_adjudications
         ON waiver_adjudications.id =
              waiver_decisions.waiver_adjudication_id
       WHERE waiver_decisions.waiver_request_id = 'request-3'
       ORDER BY waiver_adjudications.rowid`,
    ),
    [{ outcome: "error" }, { outcome: "accepted" }],
  );
  assert.equal(
    createEvaluationCollectionReader(core, Buffer.alloc(32, 7)).read(
      "evaluation-1",
    ).effective_outcome,
    "blocking",
  );
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
  assert.equal(
    createEvaluationCollectionReader(core, Buffer.alloc(32, 7)).read(
      "evaluation-1",
    ).effective_outcome,
    "error",
  );
});
