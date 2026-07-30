import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
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
  const submodule = join(directory, "submodule");
  execFileSync("git", ["init", "--initial-branch=main", submodule], {
    stdio: "ignore",
  });
  commit(submodule, "external.txt", "external contents\n", "external");
  mkdirSync(join(source, "packages"), { recursive: true });
  for (let index = 0; index < 128; index += 1) {
    writeFileSync(
      join(source, "packages", `unchanged-${index}.txt`),
      `surrounding context ${index}\n`,
    );
  }
  writeFileSync(
    join(source, ".gitattributes"),
    "*.lfs filter=lfs diff=lfs merge=lfs -text\n",
  );
  writeFileSync(
    join(source, "artifact.lfs"),
    [
      "version https://git-lfs.github.com/spec/v1",
      `oid sha256:${"a".repeat(64)}`,
      "size 999999999",
      "",
    ].join("\n"),
  );
  execFileSync(
    "git",
    [
      "-C",
      source,
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "add",
      "--quiet",
      submodule,
      "vendor/external",
    ],
    { stdio: "ignore" },
  );
  execFileSync("git", [
    "-C",
    source,
    "add",
    ".gitattributes",
    "artifact.lfs",
    "packages",
  ]);
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
    readFileSync(join(prepared.path, "packages", "unchanged-127.txt"), "utf8"),
    "surrounding context 127\n",
  );
  assert.match(
    readFileSync(join(prepared.path, "artifact.lfs"), "utf8"),
    /^version https:\/\/git-lfs\.github\.com\/spec\/v1\n/,
  );
  assert.equal(
    existsSync(join(prepared.path, "vendor", "external", "external.txt")),
    false,
  );
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
      error.code === "review_run_checkout_commit_unavailable",
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
  assert.equal(
    JSON.stringify(captures).match(/"GIT_LFS_SKIP_SMUDGE":"1"/g)?.length,
    captures.length,
  );
  assert.doesNotMatch(
    readFileSync(join(prepared.path, ".git", "config"), "utf8"),
    /private-git-token-value|private-git-user/,
  );
  prepared.remove();
});

test("hard shutdown terminates an active Git checkout with its owning error", async (context) => {
  const checkoutRoot = mkdtempSync(
    join(tmpdir(), "quality-bar-checkout-stop-"),
  );
  context.after(() => rmSync(checkoutRoot, { force: true, recursive: true }));
  const workers = new AbortController();
  const failure = Object.assign(new Error("SQLite durable write failed"), {
    code: "storage_unavailable",
  });
  /** @type {import("node:child_process").ChildProcess | undefined} */
  let gitChild;
  const checkout = prepareReviewRunCheckout({
    baseCommit: "a".repeat(40),
    checkoutRoot,
    fencingToken: 1,
    headCommit: "b".repeat(40),
    repositoryUrl: "https://example.invalid/repository.git",
    signal: workers.signal,
    spawnProcess: /** @type {typeof spawn} */ (
      /** @type {unknown} */ (
        /**
         * @param {string} _command
         * @param {string[]} _arguments
         * @param {import("node:child_process").SpawnOptions} options
         */
        (_command, _arguments, options) => {
          void _command;
          void _arguments;
          gitChild = spawn(
            process.execPath,
            [
              join(
                import.meta.dirname,
                "../fixtures/test-probes/idle-child.mjs",
              ),
            ],
            options,
          );
          return gitChild;
        }
      )
    ),
    workId: "stopped-review-run",
  });
  await new Promise((resolve) => setImmediate(resolve));

  workers.abort(failure);

  await assert.rejects(checkout, (error) => error === failure);
  assert.ok(gitChild);
  assert.ok(gitChild.exitCode !== null || gitChild.signalCode !== null);
  assert.equal(
    existsSync(join(checkoutRoot, "stopped-review-run", "1")),
    false,
  );
});

test("missing Git checkout capability is a definitive owning failure", async (context) => {
  const checkoutRoot = mkdtempSync(join(tmpdir(), "quality-bar-checkout-git-"));
  context.after(() => rmSync(checkoutRoot, { force: true, recursive: true }));
  await assert.rejects(
    () =>
      prepareReviewRunCheckout({
        baseCommit: "a".repeat(40),
        checkoutRoot,
        fencingToken: 1,
        headCommit: "b".repeat(40),
        repositoryUrl: "https://example.invalid/repository.git",
        spawnProcess: /** @type {typeof spawn} */ (
          () => {
            throw Object.assign(new Error("spawn git ENOENT"), {
              code: "ENOENT",
            });
          }
        ),
        workId: "review-run-capability",
      }),
    (error) =>
      error instanceof ReviewRunCheckoutError &&
      error.code === "review_run_checkout_capability_unavailable",
  );
});
