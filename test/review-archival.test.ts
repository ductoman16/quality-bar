import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ReviewError,
  validateArchivalRequest,
  validateReviewListState,
} from "../src/review/review-validation.ts";

test("Review archival and collection filters accept only exact lifecycle state", () => {
  assert.deepEqual(validateArchivalRequest({ archived: true }), {
    archived: true,
  });
  assert.deepEqual(validateArchivalRequest({ archived: false }), {
    archived: false,
  });
  assert.equal(validateReviewListState(undefined), "active");
  assert.equal(validateReviewListState("active"), "active");
  assert.equal(validateReviewListState("archived"), "archived");

  for (const request of [
    null,
    {},
    { archived: "true" },
    { archived: true, unexpected: true },
  ]) {
    assert.throws(
      () => validateArchivalRequest(request),
      (error) =>
        error instanceof ReviewError &&
        error.code === "review_archival_request_malformed",
    );
  }
  for (const state of ["", "all", "ACTIVE", null]) {
    assert.throws(
      () => validateReviewListState(state),
      (error) =>
        error instanceof ReviewError &&
        error.code === "review_list_state_invalid",
    );
  }
});
