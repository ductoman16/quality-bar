import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeGitHubRepositorySelection } from "../src/github-repository-selection.js";

test("GitHub Repository selection requires one exact nonempty set of stable Forge Repository IDs", () => {
  assert.deepEqual(
    normalizeGitHubRepositorySelection({ repository_ids: [101, 202] }),
    [101, 202],
  );

  for (const request of [
    null,
    {},
    { repository_ids: [] },
    { repository_ids: [101, 101] },
    { repository_ids: [0] },
    { repository_ids: ["101"] },
    { repository_ids: [101], unexpected: true },
  ]) {
    assert.throws(() => normalizeGitHubRepositorySelection(request), {
      code: "github_repository_selection_invalid",
      message:
        "GitHub Repository selection must contain unique stable Repository IDs",
    });
  }
});
