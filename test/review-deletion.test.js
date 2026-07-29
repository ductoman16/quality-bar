import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ReviewError,
  validateDeletionRequest,
} from "../src/review-validation.js";

test("Review deletion accepts only an exact empty request", () => {
  assert.deepEqual(validateDeletionRequest({}), {});

  for (const request of [null, [], { confirmed: true }]) {
    assert.throws(
      () => validateDeletionRequest(request),
      (error) =>
        error instanceof ReviewError &&
        error.code === "review_deletion_request_malformed" &&
        error.message === "Review deletion request must be an empty object",
    );
  }
});
