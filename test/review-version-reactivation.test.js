import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ReviewError,
  validateReactivationRequest,
} from "../src/review-validation.js";

test("a Review Version reactivation request accepts only one exact nonblank identity", () => {
  assert.deepEqual(
    validateReactivationRequest({ review_version_id: "review-version-1" }),
    { reviewVersionId: "review-version-1" },
  );

  for (const request of [
    null,
    {},
    { review_version_id: " " },
    { review_version_id: "review-version-1", unexpected: true },
  ]) {
    assert.throws(
      () => validateReactivationRequest(request),
      (error) =>
        error instanceof ReviewError &&
        error.code === "review_version_reactivation_request_malformed",
    );
  }
});
