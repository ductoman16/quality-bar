import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { createEvaluationService } from "../src/evaluation.js";
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

test("new explicit keys reacquire one pushed Git Changeset into distinct Evaluations", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-rerun-git-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  createBareRepository(directory, "rerun", true);
  const repository = join(directory, "rerun.git");
  const repositoryUrl = pathToFileURL(repository).href;
  const expectedCommit = execFileSync(
    "git",
    ["--git-dir", repository, "rev-parse", "main"],
    { encoding: "utf8" },
  ).trim();
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  context.after(() => core.close());
  core.run(
    "INSERT INTO repositories (id, normalized_url, created_at, verified_at) VALUES (?, ?, ?, ?)",
    "repository-rerun",
    repositoryUrl,
    1,
    1,
  );
  let evaluationId = 0;
  let acquisitions = 0;
  const evaluations = createEvaluationService(core, {
    async acquireChangeset(repositoryId, request) {
      assert.equal(repositoryId, "repository-rerun");
      acquisitions += 1;
      return resolvePushedCommitSelectors(repositoryUrl, undefined, request, {
        objectDatabaseRoot: directory,
      });
    },
    createId: () => `git-rerun-evaluation-${++evaluationId}`,
    readCodexCapabilityFailure: () => null,
    masterKey: Buffer.alloc(32, 7),
    now: () => 10,
    storageReserve: { assertWorkAdmissionAvailable() {} },
  });
  const input = {
    channel: /** @type {"implementer_token"} */ ("implementer_token"),
    repositoryId: "repository-rerun",
    request: {
      base: { type: "branch", value: "main" },
      head: { type: "commit", value: expectedCommit },
    },
  };

  const first = await evaluations.createExplicit({
    ...input,
    idempotencyKey: "git-request-1",
  });
  const second = await evaluations.createExplicit({
    ...input,
    idempotencyKey: "git-request-2",
  });

  assert.equal(acquisitions, 2);
  assert.deepEqual(
    [first.resource, second.resource].map(
      ({ id, base_commit, head_commit }) => ({
        base_commit,
        head_commit,
        id,
      }),
    ),
    [
      {
        base_commit: expectedCommit,
        head_commit: expectedCommit,
        id: "git-rerun-evaluation-1",
      },
      {
        base_commit: expectedCommit,
        head_commit: expectedCommit,
        id: "git-rerun-evaluation-2",
      },
    ],
  );
});
