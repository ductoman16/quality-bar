import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";

import { validateCostFreeEvidence } from "./cost-free-evidence-validation.mjs";
import {
  invokePaidCodexCanary,
  mergePaidCodexCanaryEvidence,
} from "./paid-codex-canary-invocation.mjs";
import { withPaidCodexCanaryLease } from "./paid-codex-canary-lease.mjs";
import { runPaidCodexCanaryLifecycle } from "./paid-codex-canary-runner.mjs";
import { readReleaseCanaryEvidence } from "./release-canary-evidence.mjs";
import { publishReleaseCanaryAttempt } from "./release-canary-publication.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const manifestPath = resolve(
  repositoryRoot,
  "artifacts/verification/evidence.json",
);
const canaryPath = resolve(
  repositoryRoot,
  "artifacts/verification/paid-codex-canary.json",
);

/** @param {...string} arguments_ */
function git(...arguments_) {
  return execFileSync("git", arguments_, {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();
}

function applicationVersion() {
  const value = readFileSync(resolve(repositoryRoot, ".env"), "utf8").match(
    /^QUALITY_BAR_VERSION=(\d+\.\d+\.\d+)$/mu,
  )?.[1];
  if (!value) {
    throw Object.assign(new Error(".env does not define QUALITY_BAR_VERSION"), {
      code: "paid_codex_canary_application_version_invalid",
    });
  }
  return value;
}

const sourceCommit = git("rev-parse", "HEAD");
const sourceStatus = git("status", "--porcelain=v1", "--untracked-files=all");
const commonDirectory = realpathSync(
  resolve(repositoryRoot, git("rev-parse", "--git-common-dir")),
);
const lockPath = join(commonDirectory, "quality-bar-paid-codex-canary.lock");

/** @param {any} manifest @param {any} canary */
function mergeValidatedEvidence(manifest, canary) {
  validateCostFreeEvidence(manifest, { repositoryRoot, sourceCommit });
  return mergePaidCodexCanaryEvidence(manifest, canary);
}

function requireCostFreeEvidence() {
  try {
    validateCostFreeEvidence(readReleaseCanaryEvidence(manifestPath), {
      repositoryRoot,
      sourceCommit,
    });
  } catch (error) {
    throw Object.assign(
      new Error(
        "complete passing same-commit cost-free evidence is required before the live canary",
        { cause: error },
      ),
      { code: "paid_codex_canary_cost_free_evidence_invalid" },
    );
  }
}

let evidence;
try {
  evidence = await runPaidCodexCanaryLifecycle({
    applicationVersion,
    canaryPath,
    invoke: (input) =>
      invokePaidCodexCanary({ ...input, processEnvironment: process.env }),
    lockPath,
    manifestPath,
    mergeEvidence: mergeValidatedEvidence,
    publish: publishReleaseCanaryAttempt,
    requireCostFreeEvidence,
    sourceCommit,
    sourceStatus,
    withLease: withPaidCodexCanaryLease,
  });
} catch (error) {
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "paid_codex_canary_failed";
  const detail =
    error instanceof Error ? error.message : "paid Codex canary failed";
  process.stderr.write(`${code}: ${detail}\n`);
  process.exitCode = 1;
}

if (evidence?.outcome === "pass") {
  process.stdout.write(
    `Paid Codex canary: PASS\nEvidence: ${canaryPath}\nShared evidence: ${manifestPath}\n`,
  );
} else if (evidence) {
  process.stderr.write(
    `${evidence.failure?.code ?? "paid_codex_canary_failed"}: ${
      evidence.failure?.detail ?? "paid Codex canary failed"
    }\n`,
  );
  process.exitCode = 1;
}
