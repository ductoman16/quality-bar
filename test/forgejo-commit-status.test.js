import assert from "node:assert/strict";
import { test } from "node:test";

import { forgejoCommitStatusForEvaluation } from "../src/forgejo-commit-status.js";

test("Forgejo uses the fixed Quality Bar status mapping", () => {
  assert.deepEqual(forgejoCommitStatusForEvaluation("pending"), {
    description: "Quality Bar Evaluation is active",
    state: "pending",
  });
  assert.equal(forgejoCommitStatusForEvaluation("clear").state, "success");
  assert.equal(forgejoCommitStatusForEvaluation("advisory").state, "failure");
  assert.equal(forgejoCommitStatusForEvaluation("blocking").state, "failure");
  assert.equal(forgejoCommitStatusForEvaluation("error").state, "error");
  assert.throws(
    () => forgejoCommitStatusForEvaluation("unknown"),
    /Evaluation outcome is invalid/,
  );
});
