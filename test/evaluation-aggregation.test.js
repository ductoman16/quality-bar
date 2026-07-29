import assert from "node:assert/strict";
import { test } from "node:test";

import { aggregateEvaluationOutcome } from "../src/evaluation-aggregation.js";

test("complete Evaluation outcome preserves error, blocking, advisory, clear precedence", () => {
  /** @type {[Parameters<typeof aggregateEvaluationOutcome>[0], string][]} */
  const scenarios = [
    [
      {
        applicabilityErrorCount: 1,
        criterionErrorCount: 0,
        failedOrCancelledReviewRunCount: 0,
        triggeredImpacts: ["blocking"],
      },
      "error",
    ],
    [
      {
        applicabilityErrorCount: 0,
        criterionErrorCount: 0,
        failedOrCancelledReviewRunCount: 1,
        triggeredImpacts: ["blocking"],
      },
      "error",
    ],
    [
      {
        applicabilityErrorCount: 0,
        criterionErrorCount: 1,
        failedOrCancelledReviewRunCount: 0,
        triggeredImpacts: ["blocking"],
      },
      "error",
    ],
    [
      {
        applicabilityErrorCount: 0,
        criterionErrorCount: 0,
        failedOrCancelledReviewRunCount: 0,
        triggeredImpacts: ["advisory", "blocking"],
      },
      "blocking",
    ],
    [
      {
        applicabilityErrorCount: 0,
        criterionErrorCount: 0,
        failedOrCancelledReviewRunCount: 0,
        triggeredImpacts: ["advisory"],
      },
      "advisory",
    ],
    [
      {
        applicabilityErrorCount: 0,
        criterionErrorCount: 0,
        failedOrCancelledReviewRunCount: 0,
        triggeredImpacts: [],
      },
      "clear",
    ],
  ];
  for (const [facts, outcome] of scenarios) {
    assert.equal(aggregateEvaluationOutcome(facts), outcome);
  }
});

test("Evaluation aggregation rejects unsupported or incomplete facts", () => {
  /** @type {unknown[]} */
  const invalidFacts = [
    null,
    {},
    {
      applicabilityErrorCount: -1,
      criterionErrorCount: 0,
      failedOrCancelledReviewRunCount: 0,
      triggeredImpacts: [],
    },
    {
      applicabilityErrorCount: 0,
      criterionErrorCount: 0,
      failedOrCancelledReviewRunCount: 0,
      triggeredImpacts: ["informational"],
    },
  ];
  for (const facts of invalidFacts) {
    assert.throws(
      () =>
        aggregateEvaluationOutcome(
          /** @type {Parameters<typeof aggregateEvaluationOutcome>[0]} */ (
            facts
          ),
        ),
      /Evaluation aggregation facts are invalid/,
    );
  }
});
