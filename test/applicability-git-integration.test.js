import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

import { evaluateApplicabilityRule } from "../src/applicability-evaluation.js";
import { resolvePushedCommitSelectors } from "../src/repository-git.js";
import { createBareRepository } from "./repository-git-integration-support.js";

test("a Boolean Applicability Rule evaluates against exact commits frozen by real Git acquisition", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-applicability-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  createBareRepository(directory, "repository", true);
  const repository = join(directory, "repository.git");
  const commit = execFileSync(
    "git",
    ["--git-dir", repository, "rev-parse", "main"],
    { encoding: "utf8" },
  ).trim();
  const frozen = await resolvePushedCommitSelectors(
    pathToFileURL(repository).href,
    undefined,
    {
      base: { type: "commit", value: commit },
      head: { type: "branch", value: "main" },
    },
    { objectDatabaseRoot: directory },
  );
  assert.deepEqual(frozen, { base_commit: commit, head_commit: commit });
  assert.equal(
    evaluateApplicabilityRule("true", frozen, {
      matchesPath() {
        throw new Error("Boolean Rule must not request File Change matching");
      },
    }).outcome,
    "applicable",
  );
});
