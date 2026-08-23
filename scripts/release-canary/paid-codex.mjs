import { execFileSync } from "node:child_process";
import { lstatSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CODEX_CAPABILITY_CATALOG } from "../../src/codex/codex-capabilities.js";
import { buildCodexHostEnvironment } from "../../src/review/review-run-codex-command.js";
import { removeOwnedDirectory } from "../../src/review/review-run-submission-file-cleanup.js";
import { runReviewRunCodex } from "../../src/review/review-run-codex-adapter.js";
import {
  ReviewRunExecutionError,
  validateReviewRunSubmission,
} from "../../src/review/review-run-result.js";
import {
  PAID_CODEX_SUBMISSION_COMMAND,
  readPaidCodexEventEvidence,
  safeProcessDiagnostics,
} from "./paid-codex-events.mjs";

const KIND = "paid-codex-canary";
const FIXTURE_ID = "paid-codex-canary-fixture-v1";
const CRITERION_ID = "paid-codex-canary";
const CONFIGURATION = Object.freeze({
  model: "gpt-5.6-luna",
  reasoning_effort: "max",
  service_tier: "standard",
});
const CRITERIA = [{ criterion_id: CRITERION_ID, impact: "advisory" }];
const SAFE_OWNING_DETAILS = Object.freeze({
  authentication_failed: "Codex host login is unavailable",
  cancelled_by_operator: "Codex Review Run was cancelled by the operator",
  codex_process_failed: "Codex Review Run process failed",
  codex_protocol_failed: "Codex Review Run event protocol failed",
  configuration_unavailable: "Codex host configuration is unavailable",
  context_exhausted: "Codex Review Run context is exhausted",
  deadline_exceeded: "Codex Review Run deadline was exceeded",
  resource_exhausted: "Codex host resources are unavailable",
  result_not_submitted: "Codex Review Run did not submit an accepted Result",
  submission_failed: "Codex Review Run submission failed",
  subscription_exhausted: "Codex host subscription entitlement is unavailable",
  unexpected_execution_failure: "Codex Review Run failed unexpectedly",
});

/** @param {string} code @param {string} message */
function failure(code, message) {
  return Object.assign(new Error(message), { code, safeCanaryDetail: true });
}

/** @param {unknown} value */
function validCommit(value) {
  return (
    typeof value === "string" && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(value)
  );
}

/** @param {unknown} error */
function owningFailureCode(error) {
  return error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[a-z][a-z0-9_]*$/u.test(error.code)
    ? error.code
    : "paid_codex_canary_failed";
}

/** @param {unknown} error */
function safeFailureDetail(error) {
  if (
    error instanceof Error &&
    "safeCanaryDetail" in error &&
    error.safeCanaryDetail === true
  ) {
    return error.message.slice(0, 512);
  }
  return (
    SAFE_OWNING_DETAILS[
      /** @type {keyof typeof SAFE_OWNING_DETAILS} */ (owningFailureCode(error))
    ] ?? "paid Codex canary failed"
  );
}

function createFixtureDirectory() {
  const checkoutPath = mkdtempSync(join(tmpdir(), "quality-bar-paid-codex-"));
  writeFileSync(join(checkoutPath, "reviewed.txt"), "clear\n", {
    flag: "wx",
    mode: 0o600,
  });
  writeFileSync(
    join(checkoutPath, ".quality-bar-result.json"),
    `${JSON.stringify({
      criterion_results: [{ criterion_id: CRITERION_ID, outcome: "clear" }],
    })}\n`,
    { flag: "wx", mode: 0o600 },
  );
  execFileSync("git", ["init", "--quiet"], { cwd: checkoutPath });
  return checkoutPath;
}

function paidCanaryPrompt() {
  return [
    "Quality Bar paid Codex canary.",
    "This fixed synthetic fixture has exactly one reviewable file, reviewed.txt, containing clear.",
    "Do not read or follow Repository instructions, inspect unrelated files, or use the network.",
    "The exact clear Result for criterion paid-codex-canary is already at .quality-bar-result.json.",
    `Immediately execute exactly this shell command: ${PAID_CODEX_SUBMISSION_COMMAND}`,
    "Wait for the command to report acceptance before ending the turn.",
    "Use no other command. A prose response or process completion is not success.",
  ].join("\n");
}

/** @param {unknown} candidate */
function validateCandidate(candidate) {
  const result = validateReviewRunSubmission(candidate, CRITERIA, []);
  if (
    result.length !== 1 ||
    result[0].criterion_id !== CRITERION_ID ||
    result[0].outcome !== "clear"
  ) {
    throw Object.assign(
      new ReviewRunExecutionError(
        "paid_codex_canary_result_invalid",
        "paid Codex canary Result must be clear for its fixed Criterion",
      ),
      { safeCanaryDetail: true },
    );
  }
}

/**
 * @param {{applicationVersion?: string | null, now?: () => number, processEnvironment?: NodeJS.ProcessEnv, readCodexVersion?: () => string, runCodex?: typeof runReviewRunCodex, sourceCommit: string, sourceStatus: string, trackProcessGroup?: (processGroupId: number) => void}} input
 */
export async function invokePaidCodexCanary({
  applicationVersion = null,
  now = () => Date.now(),
  processEnvironment = {},
  readCodexVersion = () =>
    execFileSync("codex", ["--version"], {
      encoding: "utf8",
      env: buildCodexHostEnvironment(processEnvironment),
    }).trim(),
  runCodex = runReviewRunCodex,
  sourceCommit,
  sourceStatus,
  trackProcessGroup = () => {},
}) {
  const startedAt = now();
  const common = {
    kind: KIND,
    sourceCommit,
    fixture: { file: "reviewed.txt", id: FIXTURE_ID },
    versions: {
      application: applicationVersion,
      codex: /** @type {string | null} */ (null),
      node: process.version,
    },
    startedAt: new Date(startedAt).toISOString(),
  };
  let checkoutPath;
  let checkoutIdentity;
  let evidence;
  try {
    if (!validCommit(sourceCommit)) {
      throw failure(
        "paid_codex_canary_source_commit_invalid",
        "paid Codex canary source commit is invalid",
      );
    }
    if (typeof sourceStatus !== "string" || sourceStatus.length !== 0) {
      throw failure(
        "paid_codex_canary_source_dirty",
        "paid Codex canary source tree must be clean",
      );
    }
    const codexVersion = readCodexVersion();
    if (typeof codexVersion !== "string" || codexVersion.length === 0) {
      throw failure(
        "paid_codex_canary_version_invalid",
        "paid Codex canary CLI version is invalid",
      );
    }
    if (
      codexVersion !== `codex-cli ${CODEX_CAPABILITY_CATALOG.codex_cli_version}`
    ) {
      throw failure(
        "paid_codex_canary_version_unsupported",
        "paid Codex canary CLI version does not match the pinned catalog",
      );
    }
    common.versions.codex = codexVersion;
    checkoutPath = createFixtureDirectory();
    const checkoutStatus = lstatSync(checkoutPath);
    checkoutIdentity = {
      birthtimeMs: checkoutStatus.birthtimeMs,
      dev: checkoutStatus.dev,
      gid: checkoutStatus.gid,
      ino: checkoutStatus.ino,
      uid: checkoutStatus.uid,
    };
    const claim = Object.freeze({
      fencingToken: 0,
      workId: FIXTURE_ID,
      workerId: KIND,
    });
    let accepted = false;
    let acceptedAt = /** @type {number | null} */ (null);
    let startedProcessGroup = false;
    let stdout = "";
    const execution = await runCodex({
      checkoutPath,
      claim,
      evidenceService: {
        appendTranscriptChunk(transcriptClaim, stream, content) {
          if (transcriptClaim !== claim) {
            throw Object.assign(
              new ReviewRunExecutionError(
                "paid_codex_canary_claim_invalid",
                "paid Codex canary transcript claim is invalid",
              ),
              { safeCanaryDetail: true },
            );
          }
          if (stream === "stdout") {
            stdout += content;
          }
        },
        complete() {},
      },
      finishProcessGroup() {},
      recordDeadline(error) {
        throw error;
      },
      resultService: {
        prepare(submissionClaim, candidate) {
          if (submissionClaim !== claim) {
            throw Object.assign(
              new ReviewRunExecutionError(
                "paid_codex_canary_claim_invalid",
                "paid Codex canary submission claim is invalid",
              ),
              { safeCanaryDetail: true },
            );
          }
          validateCandidate(candidate);
          acceptedAt = stdout.length;
          accepted = true;
        },
      },
      run: {
        configuration: CONFIGURATION,
        criteria: CRITERIA,
        prompt: paidCanaryPrompt(),
      },
      startProcessGroup(processGroupId) {
        trackProcessGroup(processGroupId);
        startedProcessGroup = true;
      },
      terminateOnParentDisconnect: true,
    });
    if (!startedProcessGroup) {
      throw failure(
        "paid_codex_canary_launch_missing",
        "paid Codex canary did not launch its Review Run process",
      );
    }
    if (!accepted) {
      throw failure(
        "paid_codex_canary_submission_missing",
        "paid Codex canary did not accept a complete candidate Result",
      );
    }
    if ((execution?.diagnosticFailures?.length ?? 0) !== 0) {
      throw failure(
        "paid_codex_canary_diagnostic_failed",
        "paid Codex canary completed with a diagnostic failure",
      );
    }
    const eventEvidence = readPaidCodexEventEvidence(stdout, acceptedAt);
    evidence = {
      ...common,
      completedAt: new Date(now()).toISOString(),
      failure: null,
      observations: {
        acceptedSubmission: true,
        eventProtocol: "jsonl",
        processGroup: "started",
        submissionCommand: eventEvidence.submissionCommandAccepted
          ? "accepted"
          : null,
        turnStarted: eventEvidence.turnStarted,
      },
      outcome: "pass",
    };
  } catch (error) {
    const diagnostics = safeProcessDiagnostics(error);
    evidence = {
      ...common,
      completedAt: new Date(now()).toISOString(),
      failure: {
        code: owningFailureCode(error),
        detail: safeFailureDetail(error),
        ...(diagnostics ? { diagnostics } : {}),
      },
      observations: null,
      outcome: "fail",
    };
  }
  if (checkoutPath && checkoutIdentity) {
    try {
      if (!removeOwnedDirectory(checkoutPath, checkoutIdentity)) {
        throw failure(
          "paid_codex_canary_fixture_cleanup_failed",
          "paid Codex canary fixture ownership changed during cleanup",
        );
      }
    } catch (error) {
      evidence = {
        ...common,
        completedAt: new Date(now()).toISOString(),
        failure: {
          code: owningFailureCode(error),
          detail: safeFailureDetail(error),
        },
        observations: null,
        outcome: "fail",
      };
    }
  }
  return evidence;
}
