import assert from "node:assert/strict";
import { test } from "node:test";

import { CodexConfigurationError } from "../src/codex-capabilities.js";
import { createReviewService, ReviewError } from "../src/review.js";

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

function validSnapshot(overrides = {}) {
  return {
    applicability_rule: null,
    codex_configuration: {
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      service_tier: "standard",
    },
    criteria: [
      {
        id: "criterion-1",
        impact: "advisory",
        instruction: "Keep public boundaries explicit.",
      },
    ],
    ...overrides,
  };
}

test("invalid Review definitions fail before a durable transaction can begin", () => {
  let transactionCount = 0;
  const reviews = createReviewService({
    transaction() {
      transactionCount += 1;
      throw new Error("validation started a transaction");
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
      (error) =>
        (error instanceof ReviewError ||
          error instanceof CodexConfigurationError) &&
        error.code === code,
    );
  }
  assert.equal(transactionCount, 0);
});

test("invalid Review metadata edits fail before a durable transaction can begin", () => {
  let transactionCount = 0;
  const reviews = createReviewService({
    transaction() {
      transactionCount += 1;
      throw new Error("validation started a transaction");
    },
  });

  for (const [metadata, code] of [
    [{ description: " \n", name: " \t" }, "review_name_invalid"],
    [{ description: "Still valid.", name: " \t" }, "review_name_invalid"],
    [{ description: "\n", name: "Still valid" }, "review_description_invalid"],
    [
      { description: "Still valid.", name: "Still valid", extra: true },
      "review_metadata_request_malformed",
    ],
  ]) {
    assert.throws(
      () => reviews.updateMetadata("review-1", metadata),
      (error) => error instanceof ReviewError && error.code === code,
    );
  }
  assert.equal(transactionCount, 0);
});

test("invalid executable snapshots fail before a durable transaction can begin", () => {
  let transactionCount = 0;
  const reviews = createReviewService({
    transaction() {
      transactionCount += 1;
      throw new Error("validation started a transaction");
    },
  });

  for (const [snapshot, code] of [
    [
      validSnapshot({ applicability_rule: false }),
      "review_applicability_rule_malformed",
    ],
    [validSnapshot({ criteria: [] }), "review_criteria_invalid"],
    [
      validSnapshot({
        criteria: [
          {
            id: "criterion-1",
            impact: "advisory",
            instruction: "First.",
          },
          {
            id: "criterion-1",
            impact: "blocking",
            instruction: "Duplicate.",
          },
        ],
      }),
      "review_criterion_identity_duplicate",
    ],
    [
      validSnapshot({
        criteria: [
          {
            id: " ",
            impact: "advisory",
            instruction: "Missing identity.",
          },
        ],
      }),
      "review_criterion_identity_invalid",
    ],
    [validSnapshot({ extra: true }), "review_version_request_malformed"],
  ]) {
    assert.throws(
      () => reviews.saveVersion("review-1", snapshot),
      (error) =>
        (error instanceof ReviewError ||
          error instanceof CodexConfigurationError) &&
        error.code === code,
    );
  }
  assert.equal(transactionCount, 0);
});
