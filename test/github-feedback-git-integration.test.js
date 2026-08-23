import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { projectFrozenDiffLineRange } from "../src/github/github-feedback.js";
import { readReviewRunFileChanges } from "../src/review/review-run-file-changes.js";

test("real Git frozen patch authority distinguishes projectable and unchanged lines", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-feedback-git-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  execFileSync("git", ["init", "--initial-branch=main", directory], {
    stdio: "ignore",
  });
  execFileSync("git", ["-C", directory, "config", "user.name", "Quality Bar"]);
  execFileSync("git", [
    "-C",
    directory,
    "config",
    "user.email",
    "quality-bar@example.invalid",
  ]);
  const path = join(directory, "example.js");
  let lineNumber = 0;
  const baseLines = Array.from(
    { length: 20 },
    () => `unchanged ${++lineNumber}`,
  );
  baseLines[9] = "old value";
  writeFileSync(path, `${baseLines.join("\n")}\n`);
  execFileSync("git", ["-C", directory, "add", "example.js"]);
  execFileSync("git", ["-C", directory, "commit", "-m", "base"], {
    stdio: "ignore",
  });
  const base = execFileSync("git", ["-C", directory, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const headLines = [...baseLines];
  headLines.splice(9, 1, "new value", "another value");
  writeFileSync(path, `${headLines.join("\n")}\n`);
  execFileSync("git", ["-C", directory, "add", "example.js"]);
  execFileSync("git", ["-C", directory, "commit", "-m", "head"], {
    stdio: "ignore",
  });
  const head = execFileSync("git", ["-C", directory, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();

  const [change] = readReviewRunFileChanges(directory, base, head);
  assert.deepEqual(
    projectFrozenDiffLineRange(
      {
        end_line: 11,
        kind: "line_range",
        side: "head",
        start_line: 10,
      },
      change,
    ),
    {
      line: 11,
      path: "example.js",
      side: "RIGHT",
      start_line: 10,
      start_side: "RIGHT",
    },
  );
  assert.equal(
    projectFrozenDiffLineRange(
      {
        end_line: 1,
        kind: "line_range",
        side: "head",
        start_line: 1,
      },
      change,
    ),
    null,
  );
});
