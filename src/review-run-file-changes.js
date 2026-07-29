import { execFileSync } from "node:child_process";

import { EvaluationError } from "./evaluation-validation.js";
import { fileChangesFromGitNameStatus } from "./file-change.js";
import { ReviewRunExecutionError } from "./review-run-result.js";

/**
 * @param {Buffer} contents
 * @returns {number | null}
 */
function lineCount(contents) {
  if (contents.includes(0)) {
    return null;
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(contents);
  } catch {
    return null;
  }
  if (contents.length === 0) {
    return 0;
  }
  let count = 0;
  for (const byte of contents) {
    if (byte === 10) {
      count += 1;
    }
  }
  return contents.at(-1) === 10 ? count : count + 1;
}

/**
 * @param {string} checkoutPath
 * @param {string | null} commit
 * @param {string | null} path
 */
function sideLineCount(checkoutPath, commit, path) {
  if (commit === null || path === null) {
    return null;
  }
  const entry = execFileSync("git", [
    "-C",
    checkoutPath,
    "ls-tree",
    "-z",
    commit,
    "--",
    `:(literal)${path}`,
  ]);
  const separator = entry.indexOf(9);
  const [mode, type, objectId] = entry
    .subarray(0, separator)
    .toString("utf8")
    .split(" ");
  if (!["100644", "100755"].includes(mode)) {
    return null;
  }
  if (type !== "blob" || !/^[0-9a-f]{40,64}$/.test(objectId)) {
    throw new TypeError("Frozen File Change object is invalid");
  }
  return lineCount(
    execFileSync("git", ["-C", checkoutPath, "cat-file", "blob", objectId]),
  );
}

/**
 * @param {string} checkoutPath
 * @param {string} baseCommit
 * @param {string} headCommit
 * @param {(string | null)[]} paths
 */
function frozenPatch(checkoutPath, baseCommit, headCommit, paths) {
  return execFileSync(
    "git",
    [
      "-C",
      checkoutPath,
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      baseCommit,
      headCommit,
      "--",
      ...new Set(
        paths
          .filter((path) => path !== null)
          .map((path) => `:(literal)${path}`),
      ),
    ],
    { encoding: "utf8" },
  );
}

/**
 * @param {string} checkoutPath
 * @param {string} baseCommit
 * @param {string} headCommit
 */
export function readReviewRunFileChanges(checkoutPath, baseCommit, headCommit) {
  try {
    return fileChangesFromGitNameStatus(
      execFileSync(
        "git",
        [
          "-C",
          checkoutPath,
          "diff",
          "--find-renames",
          "--name-status",
          "-z",
          baseCommit,
          headCommit,
        ],
        { encoding: "utf8" },
      ),
    ).map((change) => ({
      ...change,
      base_line_count: sideLineCount(
        checkoutPath,
        change.before_path === null ? null : baseCommit,
        change.before_path,
      ),
      head_line_count: sideLineCount(
        checkoutPath,
        change.after_path === null ? null : headCommit,
        change.after_path,
      ),
      patch: frozenPatch(checkoutPath, baseCommit, headCommit, [
        change.before_path,
        change.after_path,
      ]),
    }));
  } catch (cause) {
    if (
      cause instanceof EvaluationError &&
      [
        "evaluation_file_change_invalid",
        "evaluation_file_change_kind_unsupported",
      ].includes(cause.code)
    ) {
      throw new ReviewRunExecutionError(cause.code, cause.message, { cause });
    }
    throw new ReviewRunExecutionError(
      "finding_location_changeset_unavailable",
      "Frozen File Changes could not be inspected",
      { cause },
    );
  }
}
