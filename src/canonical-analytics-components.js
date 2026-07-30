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
        evaluation_outcomes: {
          $ref: "#/components/schemas/EvaluationOutcomeAnalytics",
        },
        finding_impact: {
          $ref: "#/components/schemas/FindingImpactAnalytics",
        },
        review_applicability: {
          items: { $ref: "#/components/schemas/ReviewApplicabilityAnalytics" },
          type: "array",
        },
        waiver_analytics: {
          $ref: "#/components/schemas/WaiverAnalytics",
        },
      },
      [
        "criterion_outcomes",
        "evaluation_outcomes",
        "finding_impact",
        "review_applicability",
        "waiver_analytics",
      ],
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
    EvaluationOutcomeAnalytics: closedObject(
      {
        advisory: count,
        advisory_rate: rate,
        blocking: count,
        blocking_rate: rate,
        clear: count,
        clear_rate: rate,
        error: count,
        error_rate: rate,
        pending: count,
      },
      [
        "clear",
        "advisory",
        "blocking",
        "error",
        "pending",
        "clear_rate",
        "advisory_rate",
        "blocking_rate",
        "error_rate",
      ],
    ),
    FindingImpactAnalytics: closedObject(
      {
        advisory: count,
        blocking: count,
        findings_per_triggered_criterion_result: rate,
      },
      ["advisory", "blocking", "findings_per_triggered_criterion_result"],
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
    WaiverAnalytics: closedObject(
      {
        advisory_findings: count,
        decision_history: {
          $ref: "#/components/schemas/WaiverDecisionHistoryAnalytics",
        },
        requested_findings: count,
        waived_findings: count,
        waived_finding_rate: rate,
        waiver_request_rate: rate,
      },
      [
        "advisory_findings",
        "requested_findings",
        "waiver_request_rate",
        "waived_findings",
        "waived_finding_rate",
        "decision_history",
      ],
    ),
    WaiverDecisionHistoryAnalytics: closedObject(
      {
        accepted: count,
        accepted_rate: rate,
        denied: count,
        denied_rate: rate,
        error: count,
        error_rate: rate,
      },
      [
        "accepted",
        "denied",
        "error",
        "accepted_rate",
        "denied_rate",
        "error_rate",
      ],
    ),
  };
}
