import assert from "node:assert/strict";
import test from "node:test";

import { effectiveEvaluationOutcome } from "../src/waiver-effective-outcome.js";

test("current waiver facts recompute pending, error, blocking, advisory, then clear", () => {
  const facts = {
    activeAdjudicationCount: 0,
    blockingFindingCount: 0,
    currentWaiverErrorCount: 0,
    resultOutcome: "advisory",
    unwaivedAdvisoryFindingCount: 0,
  };

  assert.equal(effectiveEvaluationOutcome(facts), "clear");
  assert.equal(
    effectiveEvaluationOutcome({
      ...facts,
      unwaivedAdvisoryFindingCount: 1,
    }),
    "advisory",
  );
  assert.equal(
    effectiveEvaluationOutcome({
      ...facts,
      blockingFindingCount: 1,
      unwaivedAdvisoryFindingCount: 1,
    }),
    "blocking",
  );
  assert.equal(
    effectiveEvaluationOutcome({
      ...facts,
      blockingFindingCount: 1,
      currentWaiverErrorCount: 1,
      unwaivedAdvisoryFindingCount: 1,
    }),
    "error",
  );
  assert.equal(
    effectiveEvaluationOutcome({
      ...facts,
      activeAdjudicationCount: 1,
      blockingFindingCount: 1,
      currentWaiverErrorCount: 1,
      unwaivedAdvisoryFindingCount: 1,
    }),
    "pending",
  );
});

test("an underlying Evaluation error remains error after waiver activity", () => {
  assert.equal(
    effectiveEvaluationOutcome({
      activeAdjudicationCount: 0,
      blockingFindingCount: 0,
      currentWaiverErrorCount: 0,
      resultOutcome: "error",
      unwaivedAdvisoryFindingCount: 0,
    }),
    "error",
  );
});
