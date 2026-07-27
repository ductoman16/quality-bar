import assert from "node:assert/strict";
import { test } from "node:test";

import { selectReviewVersionsForNewEvaluation } from "../src/review-selection.js";

test("new Evaluation selection pins only active Reviews while an earlier selection stays unchanged", () => {
  const active = {
    active_version: { id: "version-1" },
    archived: false,
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

test("new Evaluation selection rejects partial Review state", () => {
  for (const reviews of [
    null,
    [{}],
    [{ active_version: {}, archived: false, id: "review-1" }],
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
