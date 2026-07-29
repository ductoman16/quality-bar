import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { readReviewRunFileChanges } from "../src/review-run-file-changes.js";
import {
  ReviewRunExecutionError,
  validateReviewRunSubmission,
} from "../src/review-run-result.js";

/** @param {string} repository @param {string} message */
function commit(repository, message) {
  execFileSync("git", ["-C", repository, "add", "--all"]);
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

test("reads inclusive base/head coordinates for added, deleted, and renamed File Changes", (context) => {
  const repository = mkdtempSync(join(tmpdir(), "quality-bar-changes-"));
  context.after(() => rmSync(repository, { force: true, recursive: true }));
  execFileSync("git", ["init", "--initial-branch=main", repository], {
    stdio: "ignore",
  });
  writeFileSync(join(repository, "deleted.txt"), "one\ntwo\n");
  writeFileSync(join(repository, "renamed.txt"), "base\nline\n");
  const base = commit(repository, "base");
  rmSync(join(repository, "deleted.txt"));
  renameSync(join(repository, "renamed.txt"), join(repository, "current.txt"));
  writeFileSync(join(repository, "current.txt"), "base\nline\nhead\n");
  writeFileSync(join(repository, "added.bin"), Buffer.from([0, 1, 2]));
  writeFileSync(join(repository, ":(glob)*"), "literal pathspec filename\n");
  const head = commit(repository, "head");

  const changes = readReviewRunFileChanges(repository, base, head);
  assert.equal(changes.length, 4);
  assert.equal(new Set(changes.map(({ id }) => id)).size, 4);
  assert.ok(changes.every(({ patch }) => patch.length > 0));
  assert.match(
    changes.find(({ after_path: path }) => path === ":(glob)*")?.patch ?? "",
    /literal pathspec filename/,
  );
  assert.deepEqual(
    changes
      .map((change) => ({
        after_path: change.after_path,
        base_line_count: change.base_line_count,
        before_path: change.before_path,
        head_line_count: change.head_line_count,
      }))
      .sort((left, right) => {
        const leftPath = left.after_path ?? left.before_path ?? "";
        const rightPath = right.after_path ?? right.before_path ?? "";
        return leftPath.localeCompare(rightPath);
      }),
    [
      {
        after_path: ":(glob)*",
        base_line_count: null,
        before_path: null,
        head_line_count: 1,
      },
      {
        after_path: "added.bin",
        base_line_count: null,
        before_path: null,
        head_line_count: null,
      },
      {
        after_path: "current.txt",
        base_line_count: 2,
        before_path: "renamed.txt",
        head_line_count: 3,
      },
      {
        after_path: null,
        base_line_count: 2,
        before_path: "deleted.txt",
        head_line_count: null,
      },
    ],
  );
  const criteria = [
    { criterion_id: "criterion-1", impact: "blocking" },
    { criterion_id: "criterion-2", impact: "advisory" },
  ];
  assert.deepEqual(
    validateReviewRunSubmission(
      {
        criterion_results: [
          { criterion_id: "criterion-1", outcome: "not_applicable" },
          {
            criterion_id: "criterion-2",
            error: {
              code: "required_evidence_unavailable",
              detail: "The binary side cannot be judged as text.",
            },
            outcome: "error",
          },
        ],
      },
      criteria,
      changes,
    ),
    [
      { criterion_id: "criterion-1", outcome: "not_applicable" },
      {
        criterion_id: "criterion-2",
        error: {
          code: "required_evidence_unavailable",
          detail: "The binary side cannot be judged as text.",
        },
        outcome: "error",
      },
    ],
  );
  for (const candidate of [
    {
      criterion_results: [{ criterion_id: "criterion-1", outcome: "clear" }],
    },
    {
      criterion_results: [
        { criterion_id: "criterion-1", outcome: "clear" },
        { criterion_id: "criterion-1", outcome: "clear" },
      ],
    },
    {
      criterion_results: [
        { criterion_id: "criterion-1", outcome: "clear" },
        { criterion_id: "criterion-extra", outcome: "clear" },
      ],
    },
  ]) {
    assert.throws(
      () => validateReviewRunSubmission(candidate, criteria, changes),
      (error) =>
        error instanceof ReviewRunExecutionError &&
        error.code === "criterion_result_coverage_invalid",
    );
  }
});

test("preserves the exact unsupported File Change kind error", (context) => {
  const repository = mkdtempSync(join(tmpdir(), "quality-bar-kind-"));
  context.after(() => rmSync(repository, { force: true, recursive: true }));
  execFileSync("git", ["init", "--initial-branch=main", repository], {
    stdio: "ignore",
  });
  writeFileSync(join(repository, "entry"), "regular\n");
  const base = commit(repository, "regular");
  rmSync(join(repository, "entry"));
  symlinkSync("target", join(repository, "entry"));
  const head = commit(repository, "symlink");

  assert.throws(
    () => readReviewRunFileChanges(repository, base, head),
    (error) =>
      error instanceof ReviewRunExecutionError &&
      error.code === "evaluation_file_change_kind_unsupported" &&
      error.message === "Git File Change status T is unsupported",
  );
});
