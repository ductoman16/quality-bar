import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

import { resolvePushedCommitSelectors } from "../src/repository-git.js";
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
  assert.equal(expectedCommit.length, 64);
  assert.deepEqual(
    await resolvePushedCommitSelectors(
      pathToFileURL(repository).href,
      undefined,
      {
        base: { type: "branch", value: "main" },
        head: { type: "commit", value: expectedCommit },
      },
    ),
    { base_commit: expectedCommit, head_commit: expectedCommit },
  );
});
