import assert from "node:assert/strict";
import { test } from "node:test";

import { newlyEligibleForgejoPullRequests } from "../src/forgejo/forgejo-automatic-evaluation.js";
import { createForgejoAutomaticApplicationDependencies } from "../src/forgejo/forgejo-automatic-application-dependencies.js";

/** @param {number} number @param {Partial<{base: {sha: string}, draft: boolean, head: {sha: string}, merge_base: string, merged: boolean, merged_at: string | null, state: "closed" | "open"}>} [overrides] */
function pullRequest(number, overrides = {}) {
  return {
    base: { sha: "a".repeat(40) },
    draft: false,
    head: { sha: "b".repeat(40) },
    merge_base: "c".repeat(40),
    merged: false,
    merged_at: null,
    number,
    state: "open",
    ...overrides,
  };
}

test("Forgejo observation selects a newly ready open pull request", () => {
  const previous = [pullRequest(1, { draft: true }), pullRequest(2)];
  const current = [pullRequest(1), pullRequest(2), pullRequest(3)];

  assert.deepEqual(
    newlyEligibleForgejoPullRequests(previous, current).map(
      ({ number }) => number,
    ),
    [1, 3],
  );
});

test("Forgejo drafts, closed pull requests, and merged pull requests create no work", () => {
  assert.deepEqual(
    newlyEligibleForgejoPullRequests(
      [],
      [
        pullRequest(1, { draft: true }),
        pullRequest(2, { state: "closed" }),
        pullRequest(3, {
          merged: true,
          merged_at: "2026-08-01T12:00:00.000Z",
          state: "closed",
        }),
      ],
    ),
    [],
  );
});

test("Forgejo observation selects reopen, force-push, and retarget transitions", () => {
  assert.deepEqual(
    newlyEligibleForgejoPullRequests(
      [
        pullRequest(1),
        pullRequest(2, { state: "closed" }),
        pullRequest(3, { draft: true }),
        pullRequest(4),
        pullRequest(5, {
          merged: true,
          merged_at: "2026-08-01T12:00:00.000Z",
        }),
      ],
      [
        pullRequest(1, { head: { sha: "d".repeat(40) } }),
        pullRequest(2),
        pullRequest(3),
        pullRequest(4, {
          base: { sha: "e".repeat(40) },
          merge_base: "c".repeat(40),
        }),
        pullRequest(5),
      ],
    ),
    [
      pullRequest(1, { head: { sha: "d".repeat(40) } }),
      pullRequest(2),
      pullRequest(3),
    ],
  );
});

test("Forgejo observation rejects an invalid provider snapshot with its owning error", () => {
  assert.throws(
    () => newlyEligibleForgejoPullRequests([], [{ number: 1 }]),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "forgejo_poll_response_invalid",
  );
  assert.throws(
    () =>
      newlyEligibleForgejoPullRequests(
        [],
        [pullRequest(1, { head: { sha: "b".repeat(64) } })],
      ),
    { code: "forgejo_poll_response_invalid" },
  );
});

test("Forgejo observation retains a closed pull request whose base branch no longer exists", () => {
  const closed = pullRequest(119, {
    base: { sha: "" },
    state: "closed",
  });

  assert.deepEqual(newlyEligibleForgejoPullRequests([], [closed]), []);
});

test("Forgejo acquisition passes the stored merge-base and current head exactly", async () => {
  /** @type {unknown} */
  let resolved;
  const dependencies = createForgejoAutomaticApplicationDependencies({
    getEvaluations: () => ({ admitAutomatic: assert.fail }),
    getRepositories: () => ({
      resolveForgejoPullRequestChangeset(
        /** @type {string} */ repositoryId,
        /** @type {any} */ pullRequest,
      ) {
        resolved = { pullRequest, repositoryId };
        return Promise.resolve("changeset");
      },
    }),
  });
  const observed = pullRequest(17);

  assert.equal(
    await dependencies.acquirePullRequestChangeset({
      pullRequest: observed,
      repositoryId: "repository-1",
    }),
    "changeset",
  );
  assert.deepEqual(resolved, {
    pullRequest: {
      baseSha: observed.merge_base,
      headSha: observed.head.sha,
    },
    repositoryId: "repository-1",
  });
});
