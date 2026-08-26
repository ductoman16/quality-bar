import assert from "node:assert/strict";
import { test } from "node:test";

import { newlyEligibleGitHubPullRequests } from "../src/github/github-automatic-evaluation.ts";

function pullRequest(
  number: number,
  overrides: Partial<{
    base: { sha: string };
    draft: boolean;
    head: { sha: string };
    merged_at: string | null;
    state: "closed" | "open";
  }> = {},
) {
  return {
    base: { sha: "a".repeat(40) },
    draft: false,
    head: { sha: "b".repeat(40) },
    merged_at: null,
    number,
    state: "open",
    ...overrides,
  };
}

test("GitHub observation selects only newly ready or changed open pull requests", () => {
  const previous = [
    pullRequest(1),
    pullRequest(2, { draft: true }),
    pullRequest(3, { state: "closed" }),
    pullRequest(4),
  ];
  const current = [
    pullRequest(1),
    pullRequest(2),
    pullRequest(3),
    pullRequest(4, { head: { sha: "c".repeat(40) } }),
    pullRequest(5, { draft: true }),
    pullRequest(6),
  ];

  assert.deepEqual(
    newlyEligibleGitHubPullRequests(previous, current).map(
      ({ number }) => number,
    ),
    [2, 3, 4, 6],
  );
});

test("draft, closed, and merged pull requests are observed without Evaluation work", () => {
  assert.deepEqual(
    newlyEligibleGitHubPullRequests(
      [],
      [
        pullRequest(1, { draft: true }),
        pullRequest(2, { state: "closed" }),
        pullRequest(3, {
          merged_at: "2026-07-29T12:00:00.000Z",
          state: "closed",
        }),
      ],
    ),
    [],
  );
});
