import { closedObject } from "./canonical-schema.js";

const count = { minimum: 0, type: "integer" };
const rate = closedObject({ denominator: count, numerator: count }, [
  "numerator",
  "denominator",
]);

export function canonicalAnalyticsSchemas() {
  return {
    Analytics: closedObject(
      {
        criterion_outcomes: {
          items: { $ref: "#/components/schemas/CriterionOutcomeAnalytics" },
          type: "array",
        },
        review_applicability: {
          items: { $ref: "#/components/schemas/ReviewApplicabilityAnalytics" },
          type: "array",
        },
      },
      ["criterion_outcomes", "review_applicability"],
    ),
    CriterionOutcomeAnalytics: closedObject(
      {
        clear: count,
        clear_rate: rate,
        criterion_id: { minLength: 1, type: "string" },
        error: count,
        error_rate: rate,
        not_applicable: count,
        not_applicable_rate: rate,
        trigger_rate: rate,
        triggered: count,
      },
      [
        "criterion_id",
        "triggered",
        "clear",
        "not_applicable",
        "error",
        "trigger_rate",
        "clear_rate",
        "not_applicable_rate",
        "error_rate",
      ],
    ),
    ReviewApplicabilityAnalytics: closedObject(
      {
        applicable: count,
        applicability_rate: rate,
        error: count,
        error_rate: rate,
        not_applicable: count,
        review_id: { minLength: 1, type: "string" },
      },
      [
        "review_id",
        "applicable",
        "not_applicable",
        "error",
        "applicability_rate",
        "error_rate",
      ],
    ),
  };
}
