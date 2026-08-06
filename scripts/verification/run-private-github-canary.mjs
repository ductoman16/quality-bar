import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createGitHubVerifier } from "../../src/github-api.js";
import { validateCostFreeEvidence } from "./cost-free-evidence-validation.mjs";
import { readPrivateGitHubCanaryConfiguration } from "./private-github-canary-configuration.mjs";
import {
  invokePrivateGitHubCanary,
  mergePrivateGitHubCanaryEvidence,
} from "./private-github-canary.mjs";
import { publishReleaseCanaryAttempt } from "./release-canary-publication.mjs";
import { runPrivateGitHubCanaryLifecycle } from "./private-github-canary-runner.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const manifestPath = resolve(
  repositoryRoot,
  "artifacts/verification/evidence.json",
);
const canaryPath = resolve(
  repositoryRoot,
  "artifacts/verification/private-github-canary.json",
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
      code: "private_github_canary_application_version_invalid",
    });
  }
  return value;
}

const sourceCommit = git("rev-parse", "HEAD");
/** @param {any} manifest @param {any} canary */
const mergeValidatedEvidence = (manifest, canary) => {
  try {
    validateCostFreeEvidence(manifest, { repositoryRoot, sourceCommit });
  } catch (error) {
    throw Object.assign(
      new Error(
        "complete passing same-commit cost-free evidence is required before the live canary",
        { cause: error },
      ),
      { code: "private_github_canary_cost_free_evidence_invalid" },
    );
  }
  return mergePrivateGitHubCanaryEvidence(manifest, canary);
};
let evidence;
try {
  evidence = await runPrivateGitHubCanaryLifecycle({
    canaryPath,
    invoke: async () => {
      const configuration = readPrivateGitHubCanaryConfiguration(
        repositoryRoot,
        process.env,
      );
      return invokePrivateGitHubCanary({
        applicationVersion: applicationVersion(),
        credential: configuration.credential,
        fixture: configuration.fixture,
        gitVersion: git("--version").replace(/^git version /u, ""),
        sourceCommit,
        verifier: createGitHubVerifier(),
      });
    },
    manifestPath,
    mergeEvidence: mergeValidatedEvidence,
    publish: publishReleaseCanaryAttempt,
    sourceCommit,
  });
} catch (error) {
  const owningCode =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "private_github_canary_failed";
  const code =
    owningCode.length <= 96 && /^[a-z][a-z0-9_]*$/u.test(owningCode)
      ? owningCode
      : "private_github_canary_failed";
  const detail =
    (error instanceof Error
      ? error.message
      : "private GitHub canary failed"
    ).slice(0, 512) || "private GitHub canary failed";
  process.stderr.write(`${code}: ${detail}\n`);
  process.exitCode = 1;
}

if (evidence?.outcome === "pass") {
  process.stdout.write(
    `Private GitHub canary: PASS\nEvidence: ${canaryPath}\nShared evidence: ${manifestPath}\n`,
  );
} else if (evidence) {
  process.stderr.write(
    `${evidence.failure?.code ?? "private_github_canary_failed"}: ${
      evidence.failure?.detail ?? "private GitHub canary failed"
    }\n`,
  );
  process.exitCode = 1;
}
