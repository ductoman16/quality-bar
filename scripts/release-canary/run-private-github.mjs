import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createGitHubVerifier } from "../../src/github-api.js";
import { runReleaseCanary } from "./evidence.mjs";
import { readPrivateGitHubCanaryConfiguration } from "./private-github-configuration.mjs";
import { invokePrivateGitHubCanary } from "./private-github.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const evidencePath = resolve(
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
const sourceStatus = git("status", "--porcelain=v1", "--untracked-files=all");
const attemptId = randomUUID();
const startedAt = new Date().toISOString();

/** @param {unknown} error */
function failure(error) {
  const candidate =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "private_github_canary_failed";
  const code = /^[a-z][a-z0-9_]*$/u.test(candidate)
    ? candidate
    : "private_github_canary_failed";
  return {
    completedAt: new Date().toISOString(),
    failure: {
      code,
      detail:
        code.startsWith("private_github_canary_") && error instanceof Error
          ? error.message.slice(0, 512)
          : "private GitHub canary failed",
    },
    fixture: null,
    kind: "private-github-canary",
    observations: null,
    outcome: "fail",
    sourceCommit,
    startedAt,
    versions: {
      application: null,
      git: null,
      githubRest: "2026-03-10",
      node: process.version,
    },
  };
}

const evidence = await runReleaseCanary({
  attempt: {
    ...failure(
      Object.assign(new Error("private GitHub canary attempt started"), {
        code: "private_github_canary_attempt_started",
      }),
    ),
    invocation: { attemptId, command: "canary:private-github" },
  },
  evidencePath,
  failure,
  invoke: async () => {
    if (sourceStatus.length > 0) {
      throw Object.assign(
        new Error("private GitHub canary source tree must be clean"),
        { code: "private_github_canary_source_dirty" },
      );
    }
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
});

if (evidence.outcome === "pass") {
  process.stdout.write(
    `Private GitHub canary: PASS\nEvidence: ${evidencePath}\n`,
  );
} else {
  process.stderr.write(
    `${evidence.failure?.code ?? "private_github_canary_failed"}: ${evidence.failure?.detail ?? "private GitHub canary failed"}\n`,
  );
  process.exitCode = 1;
}
