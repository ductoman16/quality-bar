import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { commandFailure } from "./failure-reporting.mjs";

function captureCommand(repositoryRoot, command, arguments_) {
  const result = spawnSync(command, arguments_, {
    cwd: repositoryRoot,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(commandFailure(result, command, arguments_));
  }

  return result.stdout.trim();
}

function readRequiredMatch(repositoryRoot, path, pattern, description) {
  const contents = readFileSync(resolve(repositoryRoot, path), "utf8");
  const value = contents.match(pattern)?.[1];
  if (!value) {
    throw new Error(`${path} does not define ${description}`);
  }
  return value;
}

export function readVerificationMetadata(repositoryRoot) {
  const applicationVersion = readRequiredMatch(
    repositoryRoot,
    ".env",
    /^QUALITY_BAR_VERSION=(\d+\.\d+\.\d+)$/m,
    "a semantic QUALITY_BAR_VERSION",
  );
  const packagedNodeVersion = readRequiredMatch(
    repositoryRoot,
    "Dockerfile",
    /^FROM node:(\d+\.\d+\.\d+)-alpine@sha256:/m,
    "a digest-pinned Node version",
  );
  const formatterVersion = captureCommand(
    repositoryRoot,
    resolve(repositoryRoot, "node_modules/.bin/prettier"),
    ["--version"],
  );
  if (formatterVersion !== "3.7.4") {
    throw new Error(
      `node_modules/.bin/prettier must report 3.7.4, received ${formatterVersion}`,
    );
  }

  return {
    applicationVersion,
    formatterVersion,
    packagedNodeVersion,
    runnerGitVersion: captureCommand(repositoryRoot, "git", [
      "--version",
    ]).replace(/^git version /, ""),
    sourceCommit: captureCommand(repositoryRoot, "git", ["rev-parse", "HEAD"]),
  };
}
