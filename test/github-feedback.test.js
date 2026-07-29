import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatGitHubAggregateFeedback,
  formatGitHubInlineFeedback,
  projectFrozenDiffLineRange,
} from "../src/github-feedback.js";

const identity = {
  base_commit: "1".repeat(40),
  details_url:
    "https://quality-bar.example/?view=evaluations&evaluation_id=evaluation-1",
  evaluation_id: "evaluation-1",
  head_commit: "2".repeat(40),
  outcome: "blocking",
};

const fileChange = {
  after_path: "src/current.js",
  before_path: "src/prior.js",
  patch:
    "diff --git a/src/prior.js b/src/current.js\n" +
    "similarity index 80%\n" +
    "rename from src/prior.js\n" +
    "rename to src/current.js\n" +
    "@@ -8,4 +8,5 @@ function example() {\n" +
    " context\n" +
    "-removed\n" +
    "+added\n" +
    "+another\n" +
    " tail\n",
};

test("aggregate feedback contains the exact Evaluation identity and every Finding", () => {
  const body = formatGitHubAggregateFeedback(identity, [
    {
      evidence: "The changed branch bypasses authorization.",
      id: "finding-line",
      impact: "blocking",
      location: {
        end_line: 10,
        kind: "line_range",
        path: "src/current.js",
        side: "head",
        start_line: 9,
      },
      remediation: "Require authorization before the branch.",
    },
    {
      evidence: "The migration and runtime change are not atomic.",
      id: "finding-changeset",
      impact: "advisory",
      location: { kind: "changeset" },
      remediation: "Commit both changes through one transaction.",
    },
  ]);

  assert.equal(
    body,
    `## Quality Bar Evaluation

Outcome: blocking
Evaluation: \`evaluation-1\`
Frozen base: \`${"1".repeat(40)}\`
Frozen head: \`${"2".repeat(40)}\`
Internal details: https://quality-bar.example/?view=evaluations&evaluation_id=evaluation-1

### Finding \`finding-line\`
Impact: blocking
Location: head \`src/current.js\` lines 9-10
Evidence: The changed branch bypasses authorization.
Remediation: Require authorization before the branch.

### Finding \`finding-changeset\`
Impact: advisory
Location: Changeset
Evidence: The migration and runtime change are not atomic.
Remediation: Commit both changes through one transaction.`,
  );
});

test("only honest line ranges on the frozen diff receive inline coordinates", () => {
  assert.deepEqual(
    projectFrozenDiffLineRange(
      {
        end_line: 10,
        kind: "line_range",
        side: "head",
        start_line: 9,
      },
      fileChange,
    ),
    {
      line: 10,
      path: "src/current.js",
      side: "RIGHT",
      start_line: 9,
      start_side: "RIGHT",
    },
  );
  assert.deepEqual(
    projectFrozenDiffLineRange(
      {
        end_line: 8,
        kind: "line_range",
        side: "base",
        start_line: 8,
      },
      fileChange,
    ),
    {
      line: 8,
      path: "src/current.js",
      side: "RIGHT",
    },
  );
  assert.deepEqual(
    projectFrozenDiffLineRange(
      {
        end_line: 9,
        kind: "line_range",
        side: "base",
        start_line: 9,
      },
      fileChange,
    ),
    {
      line: 9,
      path: "src/current.js",
      side: "LEFT",
    },
  );
  for (const location of [
    { kind: "whole_side", side: "head" },
    { kind: "changeset" },
    {
      end_line: 7,
      kind: "line_range",
      side: "head",
      start_line: 7,
    },
    {
      end_line: 11,
      kind: "line_range",
      side: "base",
      start_line: 10,
    },
    {
      end_line: 9,
      kind: "line_range",
      side: "base",
      start_line: 8,
    },
  ]) {
    assert.equal(projectFrozenDiffLineRange(location, fileChange), null);
  }
  assert.deepEqual(
    projectFrozenDiffLineRange(
      {
        end_line: 2,
        kind: "line_range",
        side: "head",
        start_line: 1,
      },
      {
        after_path: "src/added.js",
        before_path: null,
        patch:
          "diff --git a/src/added.js b/src/added.js\n" +
          "new file mode 100644\n" +
          "@@ -0,0 +1,2 @@\n" +
          "+first\n" +
          "+second\n",
      },
    ),
    {
      line: 2,
      path: "src/added.js",
      side: "RIGHT",
      start_line: 1,
      start_side: "RIGHT",
    },
  );
});

test("inline feedback preserves the Finding and frozen Evaluation identity", () => {
  assert.equal(
    formatGitHubInlineFeedback(identity, {
      evidence: "The changed branch bypasses authorization.",
      id: "finding-line",
      impact: "blocking",
      remediation: "Require authorization before the branch.",
    }),
    `**Quality Bar — blocking**

The changed branch bypasses authorization.

Remediation: Require authorization before the branch.

Finding: \`finding-line\`
Evaluation: \`evaluation-1\`
Frozen base: \`${"1".repeat(40)}\`
Frozen head: \`${"2".repeat(40)}\`
[Internal details](https://quality-bar.example/?view=evaluations&evaluation_id=evaluation-1)`,
  );
});
