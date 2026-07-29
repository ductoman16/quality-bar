import assert from "node:assert/strict";
import { test } from "node:test";

import {
  GITHUB_COMMIT_STATUS_CONTEXT,
  githubCommitStatusForEvaluation,
} from "../src/github-commit-status.js";

test("Quality Bar maps Evaluation truth to one stable GitHub status", () => {
  assert.equal(GITHUB_COMMIT_STATUS_CONTEXT, "Quality Bar");
  assert.deepEqual(githubCommitStatusForEvaluation("pending"), {
    description: "Quality Bar Evaluation is active",
    state: "pending",
  });
  assert.deepEqual(githubCommitStatusForEvaluation("clear"), {
    description: "Quality Bar Evaluation is clear",
    state: "success",
  });
  for (const outcome of ["advisory", "blocking"]) {
    assert.deepEqual(githubCommitStatusForEvaluation(outcome), {
      description: `Quality Bar Evaluation is ${outcome}`,
      state: "failure",
    });
  }
  assert.deepEqual(githubCommitStatusForEvaluation("error"), {
    description: "Quality Bar Evaluation has an error",
    state: "error",
  });
  assert.throws(
    () => githubCommitStatusForEvaluation("skipped"),
    /Evaluation outcome is invalid/,
  );
});
