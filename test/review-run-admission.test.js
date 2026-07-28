import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertReviewRunCapacity,
  REVIEW_RUN_QUEUE_CAPACITY,
} from "../src/review-run-admission.js";

test("Review Run admission accepts only a complete batch within the shared queue cap", () => {
  assert.equal(REVIEW_RUN_QUEUE_CAPACITY, 25);
  assert.doesNotThrow(() => assertReviewRunCapacity(23, 2));
  assert.throws(
    () => assertReviewRunCapacity(24, 2),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "capacity_unavailable" &&
      error.message === "Codex execution capacity is unavailable",
  );
  assert.throws(
    () => assertReviewRunCapacity(25, 1),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "capacity_unavailable",
  );
});
