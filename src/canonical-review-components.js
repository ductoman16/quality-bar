import { closedObject, withValidationError } from "./canonical-schema.js";

export function canonicalReviewSchemas() {
  const applicabilityRule = withValidationError(
    { type: ["string", "null"] },
    "review_applicability_rule_malformed",
    "Applicability Rule must be a string or null",
  );
  const criterionImpact = withValidationError(
    { enum: ["advisory", "blocking"], type: "string" },
    "review_criterion_impact_invalid",
    "Criterion {index} impact must be advisory or blocking",
  );
  const criterionInstruction = withValidationError(
    { minLength: 1, pattern: "\\S", type: "string" },
    "review_criterion_instruction_invalid",
    "Criterion {index} instruction must be nonblank",
  );
  const criteria = (/** @type {Record<string, unknown>} */ items) =>
    withValidationError(
      { items, minItems: 1, type: "array" },
      "review_criteria_invalid",
      "Review must contain at least one Criterion",
    );
  const description = withValidationError(
    { minLength: 1, pattern: "\\S", type: "string" },
    "review_description_invalid",
    "Review description must be nonblank",
  );
  const name = withValidationError(
    { minLength: 1, pattern: "\\S", type: "string" },
    "review_name_invalid",
    "Review name must be nonblank",
  );
  return {
    CriterionCreateRequest: withValidationError(
      closedObject(
        { impact: criterionImpact, instruction: criterionInstruction },
        ["impact", "instruction"],
      ),
      "review_criterion_malformed",
      "Criterion {index} is malformed",
    ),
    CriterionVersionRequest: withValidationError(
      closedObject(
        {
          id: withValidationError(
            { minLength: 1, pattern: "\\S", type: "string" },
            "review_criterion_identity_invalid",
            "Criterion {index} identity must be nonblank",
          ),
          impact: criterionImpact,
          instruction: criterionInstruction,
        },
        ["impact", "instruction"],
      ),
      "review_criterion_malformed",
      "Criterion {index} is malformed",
    ),
    ReviewAssignment: {
      oneOf: [
        closedObject(
          { scope: { const: "installation_wide", type: "string" } },
          ["scope"],
        ),
        closedObject(
          {
            repository_ids: {
              items: withValidationError(
                { minLength: 1, pattern: "\\S", type: "string" },
                "review_assignment_repository_invalid",
                "Review Assignment Repository identity must be nonblank",
              ),
              type: "array",
              uniqueItems: true,
              "x-quality-bar-error": {
                code: "review_assignment_repository_duplicate",
                message:
                  "Review Assignment cannot select the same Repository more than once",
                status: 422,
              },
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
        applicability_rule: applicabilityRule,
        codex_configuration: { $ref: "CodexConfiguration#" },
        criteria: criteria({ $ref: "CriterionCreateRequest#" }),
        description,
        name,
      },
      ["assignment", "codex_configuration", "criteria", "description", "name"],
    ),
    ReviewMetadataUpdateRequest: closedObject(
      {
        description,
        name,
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
        applicability_rule: applicabilityRule,
        codex_configuration: { $ref: "CodexConfiguration#" },
        criteria: criteria({ $ref: "CriterionCreateRequest#" }),
        description,
        name,
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
        applicability_rule: applicabilityRule,
        codex_configuration: { $ref: "CodexConfiguration#" },
        criteria: criteria({ $ref: "CriterionVersionRequest#" }),
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
