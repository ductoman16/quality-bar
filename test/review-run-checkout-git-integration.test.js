import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  prepareReviewRunCheckout,
  ReviewRunCheckoutError,
} from "../src/review-run-checkout.js";

/**
 * @param {string} repository
 * @param {string} file
 * @param {string} contents
 * @param {string} message
 */
function commit(repository, file, contents, message) {
  writeFileSync(join(repository, file), contents);
  execFileSync("git", ["-C", repository, "add", file]);
  execFileSync(
    "git",
    [
      "-C",
      repository,
      "-c",
      "user.name=Quality Bar",
      "-c",
      "user.email=quality-bar@example.invalid",
      "commit",
      "-m",
      message,
    ],
    { stdio: "ignore" },
  );
  return execFileSync("git", ["-C", repository, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
}

test("checkout preparation creates a fresh disposable frozen-head checkout with the base available", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-checkout-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const source = join(directory, "source");
  execFileSync("git", ["init", "--initial-branch=main", source], {
    stdio: "ignore",
  });
  const base = commit(source, "reviewed.txt", "base\n", "base");
  writeFileSync(join(source, "untracked.txt"), "must not escape\n");
  const head = commit(source, "reviewed.txt", "head\n", "head");
  const checkoutRoot = join(directory, "owned-checkouts");

  const prepared = await prepareReviewRunCheckout({
    baseCommit: base,
    checkoutRoot,
    fencingToken: 7,
    headCommit: head,
    repositoryUrl: source,
    workId: "review-run-1",
  });
  assert.equal(
    readFileSync(join(prepared.path, "reviewed.txt"), "utf8"),
    "head\n",
  );
  assert.equal(existsSync(join(prepared.path, "untracked.txt")), false);
  assert.equal(
    execFileSync(
      "git",
      ["-C", prepared.path, "cat-file", "-t", `${base}^{commit}`],
      { encoding: "utf8" },
    ).trim(),
    "commit",
  );
  assert.equal(
    execFileSync("git", ["-C", prepared.path, "remote"], {
      encoding: "utf8",
    }).trim(),
    "",
  );
  writeFileSync(join(prepared.path, "codex-scratch.txt"), "discard me\n");
  prepared.remove();
  assert.equal(existsSync(prepared.path), false);

  await assert.rejects(
    () =>
      prepareReviewRunCheckout({
        baseCommit: "f".repeat(40),
        checkoutRoot,
        fencingToken: 8,
        headCommit: head,
        repositoryUrl: source,
        workId: "review-run-2",
      }),
    (error) =>
      error instanceof ReviewRunCheckoutError &&
      error.code === "review_run_checkout_failed",
  );
  assert.equal(existsSync(join(checkoutRoot, "review-run-2", "8")), false);
});

test("credentialed checkout keeps credentials out of Git arguments, environment, and checkout", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-checkout-secret-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const source = join(directory, "source");
  execFileSync("git", ["init", "--initial-branch=main", source], {
    stdio: "ignore",
  });
  const base = commit(source, "reviewed.txt", "base\n", "base");
  const head = commit(source, "reviewed.txt", "head\n", "head");
  const credential = {
    token: "private-git-token-value",
    username: "private-git-user",
  };
  /** @type {{arguments: string[], command: string, options: import("node:child_process").SpawnOptions}[]} */
  const captures = [];
  const prepared = await prepareReviewRunCheckout({
    baseCommit: base,
    checkoutRoot: join(directory, "checkouts"),
    credential,
    fencingToken: 7,
    headCommit: head,
    repositoryUrl: source,
    spawnProcess: /** @type {typeof spawn} */ (
      /**
       * @param {string} command
       * @param {string[]} arguments_
       * @param {import("node:child_process").SpawnOptions} options
       */
      (command, arguments_, options) => {
        captures.push({ arguments: arguments_, command, options });
        return spawn(command, arguments_, options);
      }
    ),
    workId: "credentialed-run",
  });
  assert.doesNotMatch(
    JSON.stringify(captures),
    /private-git-token-value|private-git-user/,
  );
  assert.doesNotMatch(
    readFileSync(join(prepared.path, ".git", "config"), "utf8"),
    /private-git-token-value|private-git-user/,
  );
  prepared.remove();
});
