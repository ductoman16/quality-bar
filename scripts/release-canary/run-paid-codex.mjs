import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { invokePaidCodexCanary } from "./paid-codex.mjs";
import { runReleaseCanary } from "./evidence.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const evidencePath = resolve(
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
const attemptId = randomUUID();
const startedAt = new Date().toISOString();

/** @param {unknown} error */
function failure(error) {
  const candidate =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "paid_codex_canary_failed";
  const code = /^[a-z][a-z0-9_]*$/u.test(candidate)
    ? candidate
    : "paid_codex_canary_failed";
  return {
    completedAt: new Date().toISOString(),
    failure: {
      code,
      detail:
        code.startsWith("paid_codex_canary_") && error instanceof Error
          ? error.message.slice(0, 512)
          : "paid Codex canary failed",
    },
    fixture: { file: "reviewed.txt", id: "paid-codex-canary-fixture-v1" },
    kind: "paid-codex-canary",
    observations: null,
    outcome: "fail",
    sourceCommit,
    startedAt,
    versions: { application: null, codex: null, node: process.version },
  };
}

const evidence = await runReleaseCanary({
  evidencePath,
  failure,
  invocation: { attemptId, command: "canary:paid-codex" },
  invoke: () =>
    invokePaidCodexCanary({
      applicationVersion: applicationVersion(),
      processEnvironment: process.env,
      sourceCommit,
      sourceStatus,
    }),
  sourceCommit,
});

if (evidence.outcome === "pass") {
  process.stdout.write(`Paid Codex canary: PASS\nEvidence: ${evidencePath}\n`);
} else {
  process.stderr.write(
    `${evidence.failure?.code ?? "paid_codex_canary_failed"}: ${evidence.failure?.detail ?? "paid Codex canary failed"}\n`,
  );
  process.exitCode = 1;
}
