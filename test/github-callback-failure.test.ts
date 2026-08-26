import assert from "node:assert/strict";
import { test } from "node:test";

import { createGitHubCallbackFailureStore } from "../src/github/github-callback-failure.ts";
import { GitHubConnectionError } from "../src/github/github-connection.ts";

test("callback failure receipts preserve exact code once and expire without stale state", () => {
  let now = 1_000;
  const store = createGitHubCallbackFailureStore({
    now: () => now,
    randomBytes: () => Buffer.alloc(32, 7),
  });
  const receipt = store.record(
    new GitHubConnectionError(
      "github_permissions_mismatch",
      "GitHub App permissions do not match the required profile",
    ),
  );
  assert.deepEqual(store.consume(receipt), {
    code: "github_permissions_mismatch",
    message: "GitHub App permissions do not match the required profile",
  });
  assert.equal(store.consume(receipt), null);
  const expired = store.record(
    new GitHubConnectionError(
      "github_installation_mismatch",
      "GitHub App installation does not match the required personal profile",
    ),
  );
  now += 60 * 60 * 1_000 + 1;
  assert.equal(store.consume(expired), null);
  assert.equal(store.consume("fabricated"), null);
  store.destroy();
});
