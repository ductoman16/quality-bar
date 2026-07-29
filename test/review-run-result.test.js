import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ReviewRunExecutionError,
  validateClearReviewRunSubmission,
} from "../src/review-run-result.js";

test("a clear Review Run submission covers every frozen Criterion exactly once", () => {
  assert.deepEqual(
    validateClearReviewRunSubmission(
      {
        criterion_results: [
          { criterion_id: "criterion-1", outcome: "clear" },
          { criterion_id: "criterion-2", outcome: "clear" },
        ],
      },
      ["criterion-1", "criterion-2"],
    ),
    [
      { criterion_id: "criterion-1", outcome: "clear" },
      { criterion_id: "criterion-2", outcome: "clear" },
    ],
  );
});

test("unsupported or incomplete submissions fail with their exact owning error", () => {
  for (const [candidate, code] of [
    [
      {
        criterion_results: [{ criterion_id: "criterion-1", outcome: "clear" }],
      },
      "criterion_result_coverage_invalid",
    ],
    [
      {
        criterion_results: [
          { criterion_id: "criterion-1", outcome: "clear" },
          { criterion_id: "criterion-1", outcome: "clear" },
        ],
      },
      "criterion_result_coverage_invalid",
    ],
    [
      {
        criterion_results: [
          { criterion_id: "criterion-1", outcome: "triggered" },
          { criterion_id: "criterion-2", outcome: "clear" },
        ],
      },
      "criterion_result_outcome_unsupported",
    ],
  ]) {
    assert.throws(
      () =>
        validateClearReviewRunSubmission(candidate, [
          "criterion-1",
          "criterion-2",
        ]),
      (error) =>
        error instanceof ReviewRunExecutionError && error.code === code,
    );
  }
});
