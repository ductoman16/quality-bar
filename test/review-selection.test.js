import assert from "node:assert/strict";
import { test } from "node:test";

import { selectReviewVersionsForNewEvaluation } from "../src/review-selection.js";

test("new Evaluation selection pins only active Reviews while an earlier selection stays unchanged", () => {
  const active = {
    active_version: { id: "version-1" },
    archived: false,
    assignment: { scope: "installation_wide" },
    id: "review-1",
  };
  const firstSelection = selectReviewVersionsForNewEvaluation([active]);

  assert.deepEqual(firstSelection, [
    { review_id: "review-1", review_version_id: "version-1" },
  ]);
  assert.deepEqual(
    selectReviewVersionsForNewEvaluation([{ ...active, archived: true }]),
    [],
  );
  assert.deepEqual(firstSelection, [
    { review_id: "review-1", review_version_id: "version-1" },
  ]);
});

test("installation-wide and Repository-specific Reviews compose additively for one Repository", () => {
  const reviews = [
    {
      active_version: { id: "version-wide" },
      archived: false,
      assignment: { scope: "installation_wide" },
      id: "review-wide",
    },
    {
      active_version: { id: "version-matching" },
      archived: false,
      assignment: {
        repository_ids: ["repository-1", "repository-2"],
        scope: "repository_set",
      },
      id: "review-matching",
    },
    {
      active_version: { id: "version-other" },
      archived: false,
      assignment: {
        repository_ids: ["repository-2"],
        scope: "repository_set",
      },
      id: "review-other",
    },
  ];

  assert.deepEqual(
    selectReviewVersionsForNewEvaluation(reviews, "repository-1"),
    [
      { review_id: "review-wide", review_version_id: "version-wide" },
      {
        review_id: "review-matching",
        review_version_id: "version-matching",
      },
    ],
  );
});

test("new Evaluation selection rejects partial Review state", () => {
  for (const reviews of [
    null,
    [{}],
    [{ active_version: {}, archived: false, id: "review-1" }],
    [
      {
        active_version: { id: "version-1" },
        archived: false,
        assignment: {
          repository_ids: [],
          scope: "repository_set",
        },
        id: "review-1",
      },
    ],
  ]) {
    assert.throws(
      () =>
        selectReviewVersionsForNewEvaluation(
          /** @type {Parameters<typeof selectReviewVersionsForNewEvaluation>[0]} */ (
            reviews
          ),
        ),
      /reviews must contain complete Review selections/,
    );
  }
});
