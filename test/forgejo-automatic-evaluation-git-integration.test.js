import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createServer } from "node:http";

import { resolvePushedCommitSelectors } from "../src/repository-git.js";

test("real Git preserves a Forgejo Repository disappearance as definitive read loss", async (context) => {
  const server = createServer((request, response) => {
    assert(request.url);
    response.statusCode = 404;
    response.end("Repository not found");
  });
  await new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(undefined)),
  );
  context.after(() => server.close());
  const address = server.address();
  assert(address && typeof address === "object");
  const objects = mkdtempSync(join(tmpdir(), "quality-bar-forgejo-pr-git-"));
  context.after(() => rmSync(objects, { force: true, recursive: true }));

  await assert.rejects(
    () =>
      resolvePushedCommitSelectors(
        `http://127.0.0.1:${address.port}/missing.git`,
        undefined,
        {
          base: { type: "commit", value: "a".repeat(40) },
          head: { type: "commit", value: "b".repeat(40) },
        },
        {
          objectDatabaseRoot: objects,
          pullRequestProvider: "forgejo",
          useMergeBase: false,
        },
      ),
    {
      code: "repository_git_read_failed",
      message: "Repository Git read failed during Evaluation acquisition",
    },
  );
});

test("real Git freezes the Forgejo PR merge-base and current head", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-forgejo-pr-git-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const repository = join(directory, "repository");
  const objects = join(directory, "objects");
  execFileSync("mkdir", ["-p", objects]);
  execFileSync("git", ["init", "--initial-branch=main", repository]);
  execFileSync("git", ["-C", repository, "config", "user.name", "Quality Bar"]);
  execFileSync("git", [
    "-C",
    repository,
    "config",
    "user.email",
    "quality-bar@example.invalid",
  ]);
  execFileSync("git", [
    "-C",
    repository,
    "commit",
    "--allow-empty",
    "-m",
    "common",
  ]);
  const common = execFileSync("git", ["-C", repository, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  execFileSync("git", ["-C", repository, "branch", "topic"]);
  execFileSync("git", [
    "-C",
    repository,
    "commit",
    "--allow-empty",
    "-m",
    "target",
  ]);
  const target = execFileSync("git", ["-C", repository, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  execFileSync("git", ["-C", repository, "switch", "topic"]);
  execFileSync("git", [
    "-C",
    repository,
    "commit",
    "--allow-empty",
    "-m",
    "head",
  ]);
  const head = execFileSync("git", ["-C", repository, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();

  const changeset = await resolvePushedCommitSelectors(
    `file://${repository}`,
    undefined,
    {
      base: { type: "commit", value: common },
      head: { type: "commit", value: head },
    },
    {
      objectDatabaseRoot: objects,
      pullRequestProvider: "forgejo",
      useMergeBase: false,
    },
  );

  assert.notEqual(target, common);
  assert.equal(changeset.base_commit, common);
  assert.equal(changeset.head_commit, head);
  changeset.release?.();
});

test("real Git preserves the Forgejo owner for an inaccessible PR head", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-forgejo-pr-git-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const repository = join(directory, "repository");
  const objects = join(directory, "objects");
  execFileSync("mkdir", ["-p", objects]);
  execFileSync("git", ["init", "--initial-branch=main", repository]);
  execFileSync("git", ["-C", repository, "config", "user.name", "Quality Bar"]);
  execFileSync("git", [
    "-C",
    repository,
    "config",
    "user.email",
    "quality-bar@example.invalid",
  ]);
  execFileSync("git", [
    "-C",
    repository,
    "commit",
    "--allow-empty",
    "-m",
    "base",
  ]);
  const base = execFileSync("git", ["-C", repository, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  execFileSync("git", [
    "-C",
    repository,
    "tag",
    "--annotate",
    "stored-object",
    "--message",
    "stored object",
  ]);
  const tagObject = execFileSync(
    "git",
    ["-C", repository, "rev-parse", "refs/tags/stored-object"],
    { encoding: "utf8" },
  ).trim();

  for (const [baseSelector, headSelector, code] of [
    [tagObject, base, "forgejo_pull_request_merge_base_inaccessible"],
    [base, tagObject, "forgejo_pull_request_head_inaccessible"],
  ]) {
    await assert.rejects(
      () =>
        resolvePushedCommitSelectors(
          `file://${repository}`,
          undefined,
          {
            base: { type: "commit", value: baseSelector },
            head: { type: "commit", value: headSelector },
          },
          {
            objectDatabaseRoot: objects,
            pullRequestProvider: "forgejo",
            useMergeBase: false,
          },
        ),
      { code },
    );
  }

  await assert.rejects(
    () =>
      resolvePushedCommitSelectors(
        `file://${repository}`,
        undefined,
        {
          base: { type: "commit", value: base },
          head: { type: "commit", value: "f".repeat(40) },
        },
        {
          objectDatabaseRoot: objects,
          pullRequestProvider: "forgejo",
          useMergeBase: false,
        },
      ),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "forgejo_pull_request_head_inaccessible" &&
      error.message === "Forgejo pull request head is inaccessible",
  );
  await assert.rejects(
    () =>
      resolvePushedCommitSelectors(
        `file://${repository}`,
        undefined,
        {
          base: { type: "commit", value: "e".repeat(40) },
          head: { type: "commit", value: base },
        },
        {
          objectDatabaseRoot: objects,
          pullRequestProvider: "forgejo",
          useMergeBase: false,
        },
      ),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "forgejo_pull_request_merge_base_inaccessible" &&
      error.message === "Forgejo pull request merge-base is inaccessible",
  );
});
