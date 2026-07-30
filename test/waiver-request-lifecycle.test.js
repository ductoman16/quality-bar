import assert from "node:assert/strict";
import test from "node:test";

import { waiverRequestNextAction } from "../src/waiver-request-lifecycle.js";

test("a Finding permits only the contract-defined next waiver action", () => {
  assert.equal(
    waiverRequestNextAction({
      acceptedRequestCount: 0,
      latestDecision: null,
      requestCount: 0,
    }),
    "new_request",
  );
  assert.equal(
    waiverRequestNextAction({
      acceptedRequestCount: 0,
      latestDecision: "denied",
      requestCount: 1,
    }),
    "new_request",
  );
  assert.equal(
    waiverRequestNextAction({
      acceptedRequestCount: 0,
      latestDecision: "denied",
      requestCount: 3,
    }),
    "limit_reached",
  );
  assert.equal(
    waiverRequestNextAction({
      acceptedRequestCount: 0,
      latestDecision: "error",
      requestCount: 1,
    }),
    "retry_error",
  );
  assert.equal(
    waiverRequestNextAction({
      acceptedRequestCount: 1,
      latestDecision: "accepted",
      requestCount: 1,
    }),
    "accepted",
  );
  assert.equal(
    waiverRequestNextAction({
      acceptedRequestCount: 0,
      latestDecision: null,
      requestCount: 1,
    }),
    "decision_required",
  );
});

test("waiver next-action facts fail fast when they are unsupported", () => {
  for (const facts of [
    null,
    { acceptedRequestCount: 0, latestDecision: "unknown", requestCount: 1 },
    { acceptedRequestCount: 0, latestDecision: null, requestCount: -1 },
    { acceptedRequestCount: 0, latestDecision: null, requestCount: 4 },
    { acceptedRequestCount: 0, latestDecision: "denied", requestCount: 0 },
    { acceptedRequestCount: 2, latestDecision: "accepted", requestCount: 1 },
  ]) {
    assert.throws(
      () => waiverRequestNextAction(/** @type {any} */ (facts)),
      /Waiver Request lifecycle facts are invalid/,
    );
  }
});
