import { execFileSync } from "node:child_process";

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
 */
export function readReviewRunFileChanges(checkoutPath, baseCommit, headCommit) {
  try {
    const fields = execFileSync(
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
    )
      .split("\0")
      .filter((field) => field.length > 0);
    const changes = [];
    for (let index = 0; index < fields.length; ) {
      const status = fields[index++];
      const kind = status[0];
      const firstPath = fields[index++];
      if (typeof firstPath !== "string") {
        throw new TypeError("Frozen File Change is invalid");
      }
      const renamedPath =
        kind === "R" || kind === "C" ? fields[index++] : undefined;
      if ((kind === "R" || kind === "C") && typeof renamedPath !== "string") {
        throw new TypeError("Frozen File Change is invalid");
      }
      const beforePath = kind === "A" ? null : firstPath;
      const afterPath =
        kind === "D"
          ? null
          : renamedPath === undefined
            ? firstPath
            : renamedPath;
      changes.push({
        after_path: afterPath,
        base_line_count: sideLineCount(
          checkoutPath,
          beforePath === null ? null : baseCommit,
          beforePath,
        ),
        before_path: beforePath,
        head_line_count: sideLineCount(
          checkoutPath,
          afterPath === null ? null : headCommit,
          afterPath,
        ),
        id: `file-change-${changes.length + 1}`,
      });
    }
    return changes;
  } catch (cause) {
    throw new ReviewRunExecutionError(
      "finding_location_changeset_unavailable",
      "Frozen File Changes could not be inspected",
      { cause },
    );
  }
}
