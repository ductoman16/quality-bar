import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

import { createGitHubVerifier } from "../../src/github-api.js";
import { readPrivateGitHubCanaryConfiguration } from "./private-github-canary-configuration.mjs";
import {
  invokePrivateGitHubCanary,
  mergePrivateGitHubCanaryEvidence,
} from "./private-github-canary.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const manifestPath = resolve(
  repositoryRoot,
  "artifacts/verification/evidence.json",
);
const canaryPath = resolve(
  repositoryRoot,
  "artifacts/verification/private-github-canary.json",
);

/** @param {string} path @param {unknown} value */
function atomicJson(path, value) {
  const temporaryDirectory = mkdtempSync(
    join(dirname(path), ".private-github-canary-"),
  );
  const temporaryPath = join(temporaryDirectory, "evidence.json");
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      mode: 0o600,
    });
    chmodSync(temporaryPath, 0o600);
    renameSync(temporaryPath, path);
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
}

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

try {
  const sourceCommit = git("rev-parse", "HEAD");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (
    manifest?.sourceCommit !== sourceCommit ||
    manifest?.outcome !== "pass" ||
    manifest?.verification?.kind !== "cost-free" ||
    manifest?.failures?.length !== 0
  ) {
    throw Object.assign(
      new Error(
        "passing same-commit cost-free evidence is required before the live canary",
      ),
      { code: "private_github_canary_cost_free_evidence_invalid" },
    );
  }
  const configuration = readPrivateGitHubCanaryConfiguration(
    repositoryRoot,
    process.env,
  );
  const canary = await invokePrivateGitHubCanary({
    applicationVersion: applicationVersion(),
    credential: configuration.credential,
    fixture: configuration.fixture,
    gitVersion: git("--version").replace(/^git version /u, ""),
    sourceCommit,
    verifier: createGitHubVerifier(),
  });
  atomicJson(canaryPath, canary);
  if (canary.outcome !== "pass") {
    const canaryFailure = canary.failure;
    if (!canaryFailure) {
      throw Object.assign(new Error("failed canary has no owning failure"), {
        code: "private_github_canary_evidence_invalid",
      });
    }
    process.stderr.write(`${canaryFailure.code}: ${canaryFailure.detail}\n`);
    process.exitCode = 1;
  } else {
    atomicJson(
      manifestPath,
      mergePrivateGitHubCanaryEvidence(manifest, canary),
    );
    process.stdout.write(
      `Private GitHub canary: PASS\nEvidence: ${canaryPath}\nShared evidence: ${manifestPath}\n`,
    );
  }
} catch (error) {
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "private_github_canary_failed";
  const detail = error instanceof Error ? error.message : String(error);
  atomicJson(canaryPath, {
    kind: "private-github-canary",
    sourceCommit: git("rev-parse", "HEAD"),
    fixture: null,
    versions: {
      application: null,
      node: process.version,
      git: null,
      githubRest: "2026-03-10",
    },
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    outcome: "fail",
    observations: null,
    failure: { code, detail },
  });
  process.stderr.write(`${code}: ${detail}\n`);
  process.exitCode = 1;
}
