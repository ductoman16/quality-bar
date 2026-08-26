import assert from "node:assert/strict";
import { test } from "node:test";

import { aggregateEvaluationOutcome } from "../src/evaluation/evaluation-aggregation.ts";

test("complete Evaluation outcome preserves error, blocking, advisory, clear precedence", () => {
  const scenarios: [
    Parameters<typeof aggregateEvaluationOutcome>[0],
    string,
  ][] = [
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
  const invalidFacts: unknown[] = [
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
          facts as Parameters<typeof aggregateEvaluationOutcome>[0],
        ),
      /Evaluation aggregation facts are invalid/,
    );
  }
});
