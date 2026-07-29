import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { GitHubConnectionError } from "../src/github-connection-error.js";
import { verifyGitHubRepositoryRead } from "../src/github-git-verification.js";
import { createGitHubPollingService } from "../src/github-polling.js";
import { createGitHubCommitStatusPublisher } from "../src/github-commit-status-api.js";
import {
  resolvePushedCommitSelectors,
  verifyRepositoryRead,
} from "../src/repository-git.js";

test("real Git distinguishes transient GitHub failure from definitive access loss", async (context) => {
  const server = createServer((request, response) => {
    response.writeHead(request.url?.startsWith("/denied") ? 403 : 503).end();
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(undefined));
  });
  context.after(
    () => new Promise((resolve) => server.close(() => resolve(undefined))),
  );
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  /** @type {typeof verifyRepositoryRead} */
  const verifyGit = (url, credential, options) =>
    verifyRepositoryRead(url, credential, options);
  for (const [path, code] of [
    ["transient", "github_git_verification_failed"],
    ["denied", "github_repository_git_read_failed"],
  ]) {
    await assert.rejects(
      () =>
        verifyGitHubRepositoryRead(
          verifyGit,
          {
            clone_url: `http://127.0.0.1:${address.port}/${path}.git`,
            id: 101,
          },
          "installation-token",
          [101],
        ),
      (error) => error instanceof GitHubConnectionError && error.code === code,
    );
  }
});

test("a GitHub baseline preserves exact real Git base and head object IDs", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-github-poll-git-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const repository = join(directory, "repository");
  execFileSync("git", ["init", "--initial-branch=main", repository], {
    stdio: "ignore",
  });
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
    "commit",
    "--allow-empty",
    "-m",
    "head",
  ]);
  const head = execFileSync("git", ["-C", repository, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  core.run(
    `INSERT INTO github_connections (
       id, app_id, app_slug, installation_id, principal_id, principal_login,
       api_profile, permissions, capabilities, repository_count, created_at,
       verified_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "connection-1",
    47,
    "quality-bar",
    73,
    91,
    "operator",
    "github-rest:2026-03-10",
    "{}",
    "{}",
    1,
    1,
    1,
  );
  const polling = createGitHubPollingService(core, {
    async fetchPullRequests() {
      return [
        {
          base: { sha: base },
          draft: false,
          head: { sha: head },
          merged_at: null,
          number: 1,
          state: "open",
        },
      ];
    },
    now: () => 1_000,
    recordOwningFailure() {},
  });
  await polling.baseline({
    connection: { id: "connection-1" },
    credential: {},
    repositories: [{ id: 101 }],
  });
  const snapshot = JSON.parse(
    /** @type {string} */ (
      core.get(
        "SELECT snapshot FROM github_repository_polls WHERE forge_repository_id = 101",
      )?.snapshot
    ),
  );
  assert.equal(snapshot[0].base.sha, base);
  assert.equal(snapshot[0].head.sha, head);
  core.close();
});

test("real Git proves the stored pull-request merge-base and current head pair", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-github-pr-git-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const repository = join(directory, "repository");
  const objectDatabases = join(directory, "objects");
  execFileSync("mkdir", ["-p", objectDatabases]);
  execFileSync("git", ["init", "--initial-branch=main", repository], {
    stdio: "ignore",
  });
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
    "target advanced",
  ]);
  const target = execFileSync("git", ["-C", repository, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  execFileSync("git", ["-C", repository, "switch", "topic"], {
    stdio: "ignore",
  });
  execFileSync("git", [
    "-C",
    repository,
    "commit",
    "--allow-empty",
    "-m",
    "pull request head",
  ]);
  const head = execFileSync("git", ["-C", repository, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();

  const changeset = await resolvePushedCommitSelectors(
    `file://${repository}`,
    undefined,
    {
      base: { type: "commit", value: target },
      head: { type: "commit", value: head },
    },
    { objectDatabaseRoot: objectDatabases, useMergeBase: true },
  );

  assert.equal(changeset.base_commit, common);
  assert.equal(changeset.head_commit, head);
  changeset.release?.();

  execFileSync("git", [
    "-C",
    repository,
    "commit",
    "--allow-empty",
    "-m",
    "force-pushed head",
  ]);
  const changedHead = execFileSync(
    "git",
    ["-C", repository, "rev-parse", "HEAD"],
    { encoding: "utf8" },
  ).trim();
  const changed = await resolvePushedCommitSelectors(
    `file://${repository}`,
    undefined,
    {
      base: { type: "commit", value: target },
      head: { type: "commit", value: changedHead },
    },
    { objectDatabaseRoot: objectDatabases, useMergeBase: true },
  );
  assert.equal(changed.base_commit, common);
  assert.equal(changed.head_commit, changedHead);
  changed.release?.();

  let statusPath = "";
  const publishStatus = createGitHubCommitStatusPublisher({
    fail(code, message) {
      throw Object.assign(new Error(message), { code });
    },
    async installationToken() {
      return "installation-token";
    },
    async request(path) {
      statusPath = path;
      return {
        context: "Quality Bar",
        sha: changeset.head_commit,
        state: "success",
        target_url: "https://quality-bar.example/evaluation-1",
      };
    },
  });
  await publishStatus(
    {},
    73,
    { full_name: "operator/repository", id: 101 },
    {
      description: "Quality Bar Evaluation is clear",
      head: changeset.head_commit,
      state: "success",
      targetUrl: "https://quality-bar.example/evaluation-1",
    },
  );
  assert.equal(statusPath, `/repos/operator/repository/statuses/${head}`);
  assert.notEqual(
    statusPath,
    `/repos/operator/repository/statuses/${changedHead}`,
  );

  execFileSync("git", ["-C", repository, "reset", "--hard", head], {
    stdio: "ignore",
  });
  const returned = await resolvePushedCommitSelectors(
    `file://${repository}`,
    undefined,
    {
      base: { type: "commit", value: target },
      head: { type: "commit", value: head },
    },
    { objectDatabaseRoot: objectDatabases, useMergeBase: true },
  );
  assert.equal(returned.base_commit, common);
  assert.equal(returned.head_commit, head);
  returned.release?.();

  await assert.rejects(
    () =>
      resolvePushedCommitSelectors(
        `file://${repository}`,
        undefined,
        {
          base: { type: "commit", value: target },
          head: { type: "commit", value: "f".repeat(40) },
        },
        { objectDatabaseRoot: objectDatabases, useMergeBase: true },
      ),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "github_pull_request_head_inaccessible" &&
      error.message === "GitHub pull request head is inaccessible",
  );
});
