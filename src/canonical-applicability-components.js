import { closedObject } from "./canonical-schema.js";

export function canonicalApplicabilitySchemas() {
  const identity = {
    assignment: closedObject(
      {
        scope: {
          enum: ["installation_wide", "repository_specific"],
          type: "string",
        },
      },
      ["scope"],
    ),
    review_id: { minLength: 1, type: "string" },
    review_version_id: { minLength: 1, type: "string" },
  };
  const rule = closedObject(
    {
      profile: { const: "quality-bar-restricted-cel-v1", type: "string" },
      source: { minLength: 1, type: "string" },
    },
    ["profile", "source"],
  );
  /** @param {string} kind @param {boolean} minimumPredicates */
  const branchEvidence = (kind, minimumPredicates) =>
    closedObject(
      {
        branch_ids: {
          items: { pattern: "^branch-[1-9][0-9]*$", type: "string" },
          type: "array",
        },
        kind: { const: kind, type: "string" },
        predicate_ids: {
          items: { pattern: "^predicate-[1-9][0-9]*$", type: "string" },
          ...(minimumPredicates ? { minItems: 1 } : {}),
          type: "array",
        },
      },
      ["kind", "branch_ids", "predicate_ids"],
    );
  const unconditionalEvidence = closedObject(
    { kind: { const: "unconditional", type: "string" } },
    ["kind"],
  );
  const failedEvidence = branchEvidence("failed_branches", false);
  const satisfiedEvidence = branchEvidence("satisfied_branches", true);
  const matchedEvidence = closedObject(
    {
      kind: { const: "matched", type: "string" },
      matches: {
        items: closedObject(
          {
            after_path: { type: ["string", "null"] },
            before_path: { type: ["string", "null"] },
            branch_ids: {
              items: { pattern: "^branch-[1-9][0-9]*$", type: "string" },
              minItems: 1,
              type: "array",
            },
            file_change_id: { minLength: 1, type: "string" },
            predicate_ids: {
              items: {
                pattern: "^predicate-[1-9][0-9]*$",
                type: "string",
              },
              minItems: 1,
              type: "array",
            },
            sides: {
              items: {
                enum: ["change", "before", "after"],
                type: "string",
              },
              minItems: 1,
              type: "array",
            },
          },
          [
            "file_change_id",
            "before_path",
            "after_path",
            "branch_ids",
            "predicate_ids",
            "sides",
          ],
        ),
        minItems: 1,
        type: "array",
      },
    },
    ["kind", "matches"],
  );
  /**
   * @param {string} outcome
   * @param {Record<string, unknown>} resultRule
   * @param {Record<string, unknown>} evidence
   */
  const result = (outcome, resultRule, evidence) =>
    closedObject(
      {
        ...identity,
        evidence,
        outcome: { const: outcome, type: "string" },
        rule: resultRule,
      },
      [
        "review_id",
        "review_version_id",
        "assignment",
        "rule",
        "outcome",
        "evidence",
      ],
    );
  return {
    ApplicabilityResult: {
      oneOf: [
        result("applicable", { type: "null" }, unconditionalEvidence),
        result("applicable", rule, {
          oneOf: [satisfiedEvidence, matchedEvidence],
        }),
        result("not_applicable", rule, failedEvidence),
        closedObject(
          {
            ...identity,
            error: closedObject(
              {
                code: { pattern: "^[a-z][a-z0-9_]*$", type: "string" },
                detail: { minLength: 1, type: "string" },
                file_change_id: { minLength: 1, type: "string" },
                predicate_id: {
                  pattern: "^predicate-[1-9][0-9]*$",
                  type: "string",
                },
                side: { enum: ["before", "after"], type: "string" },
              },
              ["code", "detail"],
            ),
            outcome: { const: "error", type: "string" },
            rule,
          },
          [
            "review_id",
            "review_version_id",
            "assignment",
            "rule",
            "outcome",
            "error",
          ],
        ),
      ],
    },
  };
}
