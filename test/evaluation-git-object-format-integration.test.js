import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

import { resolvePushedCommitSelectors } from "../src/repository-git.js";
import { EvaluationError } from "../src/evaluation-validation.js";
import { createBareRepository } from "./repository-git-integration-support.js";

test("Evaluation acquisition freezes native SHA-256 commit object IDs", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-sha256-git-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  createBareRepository(directory, "sha256", true, "sha256");
  const repository = join(directory, "sha256.git");
  const expectedCommit = execFileSync(
    "git",
    ["--git-dir", repository, "rev-parse", "main"],
    { encoding: "utf8" },
  ).trim();
  let acquisitionDirectory = "";
  assert.equal(expectedCommit.length, 64);
  const frozen = await resolvePushedCommitSelectors(
    pathToFileURL(repository).href,
    undefined,
    {
      base: { type: "branch", value: "main" },
      head: { type: "commit", value: expectedCommit },
    },
    {
      objectDatabaseRoot: directory,
      removeDirectory(path) {
        acquisitionDirectory = path;
        rmSync(path, { force: true, recursive: true });
      },
    },
  );
  assert.equal(frozen.base_commit, expectedCommit);
  assert.equal(frozen.head_commit, expectedCommit);
  assert.deepEqual(frozen.file_changes, []);
  frozen.release();
  assert.ok(acquisitionDirectory.startsWith(`${directory}/`));
  await assert.rejects(
    () =>
      resolvePushedCommitSelectors(
        pathToFileURL(repository).href,
        undefined,
        {
          base: { type: "commit", value: expectedCommit.slice(0, 40) },
          head: { type: "commit", value: expectedCommit },
        },
        { objectDatabaseRoot: directory },
      ),
    (error) =>
      error instanceof EvaluationError &&
      error.code === "evaluation_selector_invalid",
  );
});
