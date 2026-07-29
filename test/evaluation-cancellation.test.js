import assert from "node:assert/strict";
import { test } from "node:test";

import {
  signalReviewRunCancellations,
  subscribeReviewRunCancellation,
} from "../src/evaluation-cancellation.js";

test("Review Run cancellation signals only the exact running work after durable cancellation", () => {
  /** @type {string[]} */
  const signals = [];
  const unsubscribeFirst = subscribeReviewRunCancellation("review-run-1", () =>
    signals.push("review-run-1"),
  );
  const unsubscribeSecond = subscribeReviewRunCancellation("review-run-2", () =>
    signals.push("review-run-2"),
  );

  signalReviewRunCancellations(["review-run-2"]);
  unsubscribeSecond();
  signalReviewRunCancellations(["review-run-2"]);
  signalReviewRunCancellations(["review-run-1"]);
  unsubscribeFirst();

  assert.deepEqual(signals, ["review-run-2", "review-run-1"]);
});

test("Review Run cancellation signal rejects malformed or duplicate identities", () => {
  assert.throws(
    () => subscribeReviewRunCancellation("", () => {}),
    /Review Run cancellation subscription is invalid/,
  );
  assert.throws(
    () => signalReviewRunCancellations(["review-run-1", "review-run-1"]),
    /Review Run cancellation identities are invalid/,
  );
});
