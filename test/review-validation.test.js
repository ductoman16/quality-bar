import assert from "node:assert/strict";
import { test } from "node:test";

import { createReviewService } from "../src/review.js";

function validDefinition(overrides = {}) {
  return {
    assignment: { scope: "installation_wide" },
    codex_configuration: {
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      service_tier: "standard",
    },
    criteria: [
      { impact: "advisory", instruction: "Keep public boundaries explicit." },
    ],
    description: "Protect public behavior.",
    name: "Public boundaries",
    ...overrides,
  };
}

test("invalid Review definitions fail before a durable transaction can begin", () => {
  let transactionCount = 0;
  const reviews = createReviewService({
    transaction() {
      transactionCount += 1;
    },
  });

  for (const [definition, code] of [
    [validDefinition({ name: " \t" }), "review_name_invalid"],
    [validDefinition({ description: "\n" }), "review_description_invalid"],
    [validDefinition({ criteria: [] }), "review_criteria_invalid"],
    [
      validDefinition({
        criteria: [{ impact: "critical", instruction: "Check this." }],
      }),
      "review_criterion_impact_invalid",
    ],
    [
      validDefinition({ assignment: { scope: "repository_set" } }),
      "review_assignment_unsupported",
    ],
    [
      validDefinition({
        codex_configuration: {
          model: "gpt-5.6-terra",
          reasoning_effort: "ultra",
          service_tier: "standard",
        },
      }),
      "codex_reasoning_effort_unsupported",
    ],
    [validDefinition({ extra: true }), "review_request_malformed"],
  ]) {
    assert.throws(
      () => reviews.create(definition),
      (error) => error.code === code,
    );
  }
  assert.equal(transactionCount, 0);
});
