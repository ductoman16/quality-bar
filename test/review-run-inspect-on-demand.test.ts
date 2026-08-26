import assert from "node:assert/strict";
import { test } from "node:test";

import { createReviewRunPrompt } from "../src/review/review-run-execution.ts";

test("the Review Run receives frozen identities without a host-selected patch or coverage policy", () => {
  const prompt = createReviewRunPrompt({
    baseCommit: "a".repeat(40),
    criteria: [
      {
        criterionId: "criterion-1",
        impact: "blocking",
        instruction: "Inspect the changed behavior",
      },
    ],
    fileChanges: [
      {
        added: true,
        after_path: "src/changed.js",
        base_line_count: null,
        before_path: null,
        deleted: false,
        head_line_count: 1,
        id: "file-change-1",
        modified: false,
        patch: "host-injected-patch-must-not-appear",
        renamed: false,
      },
    ],
    headCommit: "b".repeat(40),
    reviewName: "Correctness",
  });

  assert.match(prompt, /Inspect surrounding Repository material on demand/);
  assert.match(
    prompt,
    /Quality Bar does not inject the complete patch or select a subset/,
  );
  assert.match(
    prompt,
    /Do not inspect binary contents, download Git LFS objects, or initialize submodules/,
  );
  assert.match(prompt, /submit an exact Criterion error/);
  assert.doesNotMatch(prompt, /host-injected-patch-must-not-appear/);
  assert.doesNotMatch(
    prompt,
    /chunking|ranking|summarization|multi-pass|token ceiling|coverage percentage|file ledger/i,
  );
});
