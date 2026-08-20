import { closedObject } from "./canonical-schema.js";

export function canonicalReviewSchemas() {
  return {
    CriterionCreateRequest: closedObject(
      {
        impact: { enum: ["advisory", "blocking"], type: "string" },
        instruction: { minLength: 1, pattern: "\\S", type: "string" },
      },
      ["impact", "instruction"],
    ),
    CriterionVersionRequest: {
      oneOf: [
        closedObject(
          {
            id: { minLength: 1, pattern: "\\S", type: "string" },
            impact: { enum: ["advisory", "blocking"], type: "string" },
            instruction: { minLength: 1, pattern: "\\S", type: "string" },
          },
          ["id", "impact", "instruction"],
        ),
        { $ref: "CriterionCreateRequest#" },
      ],
    },
    ReviewAssignment: {
      oneOf: [
        closedObject(
          { scope: { const: "installation_wide", type: "string" } },
          ["scope"],
        ),
        closedObject(
          {
            repository_ids: {
              items: { minLength: 1, pattern: "\\S", type: "string" },
              type: "array",
              uniqueItems: true,
            },
            scope: { const: "repository_set", type: "string" },
          },
          ["scope", "repository_ids"],
        ),
      ],
    },
    ReviewCreationAssignment: { $ref: "ReviewAssignment#" },
    ReviewCreateRequest: closedObject(
      {
        assignment: { $ref: "ReviewCreationAssignment#" },
        applicability_rule: { type: ["string", "null"] },
        codex_configuration: { $ref: "CodexConfiguration#" },
        criteria: {
          items: { $ref: "CriterionCreateRequest#" },
          minItems: 1,
          type: "array",
        },
        description: { minLength: 1, pattern: "\\S", type: "string" },
        name: { minLength: 1, pattern: "\\S", type: "string" },
      },
      ["assignment", "codex_configuration", "criteria", "description", "name"],
    ),
    ReviewMetadataUpdateRequest: closedObject(
      {
        description: { minLength: 1, pattern: "\\S", type: "string" },
        name: { minLength: 1, pattern: "\\S", type: "string" },
      },
      ["name", "description"],
    ),
    OnboardingReviewSelectionRequest: closedObject(
      {
        review_ids: {
          items: { minLength: 1, type: "string" },
          type: "array",
          uniqueItems: true,
        },
      },
      ["review_ids"],
    ),
    OnboardingReviewSelectionResult: closedObject(
      {
        added_review_ids: { items: { type: "string" }, type: "array" },
        removed_review_ids: { items: { type: "string" }, type: "array" },
      },
      ["added_review_ids", "removed_review_ids"],
    ),
    OnboardingReviewCreateRequest: closedObject(
      {
        applicability_rule: { type: ["string", "null"] },
        codex_configuration: { $ref: "CodexConfiguration#" },
        criteria: {
          items: { $ref: "CriterionCreateRequest#" },
          minItems: 1,
          type: "array",
        },
        description: { minLength: 1, pattern: "\\S", type: "string" },
        name: { minLength: 1, pattern: "\\S", type: "string" },
      },
      [
        "name",
        "description",
        "codex_configuration",
        "criteria",
        "applicability_rule",
      ],
    ),
    ReviewArchivalRequest: closedObject({ archived: { type: "boolean" } }, [
      "archived",
    ]),
    ReviewVersionSaveRequest: closedObject(
      {
        applicability_rule: { type: ["string", "null"] },
        codex_configuration: { $ref: "CodexConfiguration#" },
        criteria: {
          items: { $ref: "CriterionVersionRequest#" },
          minItems: 1,
          type: "array",
        },
      },
      ["applicability_rule", "codex_configuration", "criteria"],
    ),
    ReviewVersionReactivationRequest: closedObject(
      {
        review_version_id: {
          minLength: 1,
          pattern: "\\S",
          type: "string",
        },
      },
      ["review_version_id"],
    ),
    Criterion: closedObject(
      {
        id: { type: "string" },
        impact: { enum: ["advisory", "blocking"], type: "string" },
        instruction: { type: "string" },
        position: { minimum: 1, type: "integer" },
      },
      ["id", "impact", "instruction", "position"],
    ),
    ReviewVersion: closedObject(
      {
        applicability_rule: { type: ["string", "null"] },
        codex_configuration: { $ref: "CodexConfiguration#" },
        criteria: {
          items: { $ref: "Criterion#" },
          minItems: 1,
          type: "array",
        },
        id: { type: "string" },
        number: { minimum: 1, type: "integer" },
      },
      ["id", "number", "applicability_rule", "codex_configuration", "criteria"],
    ),
    Review: closedObject(
      {
        active_version: { $ref: "ReviewVersion#" },
        archived: { type: "boolean" },
        assignment: { $ref: "ReviewAssignment#" },
        deletion_eligible: { type: "boolean" },
        description: { type: "string" },
        id: { type: "string" },
        name: { type: "string" },
        versions: {
          items: { $ref: "ReviewVersion#" },
          minItems: 1,
          type: "array",
        },
      },
      [
        "id",
        "name",
        "description",
        "archived",
        "assignment",
        "deletion_eligible",
        "active_version",
        "versions",
      ],
    ),
    ReviewVersionSaveResult: closedObject(
      { changed: { type: "boolean" }, review: { $ref: "Review#" } },
      ["changed", "review"],
    ),
    ReviewVersionReactivationResult: closedObject(
      { changed: { type: "boolean" }, review: { $ref: "Review#" } },
      ["changed", "review"],
    ),
    ReviewArchivalResult: closedObject(
      { changed: { type: "boolean" }, review: { $ref: "Review#" } },
      ["changed", "review"],
    ),
    ReviewAssignmentChangeResult: closedObject(
      { changed: { type: "boolean" }, review: { $ref: "Review#" } },
      ["changed", "review"],
    ),
    ReviewCollection: closedObject(
      { reviews: { items: { $ref: "Review#" }, type: "array" } },
      ["reviews"],
    ),
  };
}
