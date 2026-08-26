import assert from "node:assert/strict";
import test from "node:test";

import { createWaiverAdjudicationEvidenceService } from "../src/waiver/waiver-adjudication-evidence.ts";

test("malformed terminal token counters fail before durable evidence", () => {
  const evidence = createWaiverAdjudicationEvidenceService({
    transaction() {
      assert.fail("malformed evidence reached durable storage");
    },
  });
  for (const tokenCounters of [
    {
      cached_input_tokens: 0,
      input_tokens: Number.NaN,
      output_tokens: 0,
    },
    {
      cached_input_tokens: -1,
      input_tokens: 0,
      output_tokens: 0,
    },
    {
      cached_input_tokens: 0,
      input_tokens: 0,
      output_tokens: undefined,
    },
  ]) {
    assert.throws(
      () =>
        evidence.complete(
          { fencingToken: 1, workerId: "worker-1", workId: "adjudication-1" },
          { exitCode: 0, signal: null, tokenCounters },
        ),
      /Waiver Adjudication terminal evidence is invalid/,
    );
  }
});
