import { closedObject } from "./canonical-schema.js";

export function canonicalEvaluationSchemas() {
  const emptyCollection = { maxItems: 0, type: "array" };
  return {
    EvaluationSelector: {
      oneOf: [
        closedObject(
          {
            type: { const: "branch", type: "string" },
            value: {
              minLength: 1,
              pattern:
                "^(?!@$)(?![./])(?!.*(?:\\.\\.|//|@\\{|[\\u0000-\\u0020\\u007f~^:?*\\[\\\\]))(?!.*(?:^|/)\\.)(?!.*\\.lock(?:/|$))(?!.*[./]$).+$",
              type: "string",
            },
          },
          ["type", "value"],
        ),
        closedObject(
          {
            type: { const: "commit", type: "string" },
            value: {
              pattern: "^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$",
              type: "string",
            },
          },
          ["type", "value"],
        ),
      ],
    },
    ExplicitEvaluationRequest: closedObject(
      {
        base: { $ref: "#/components/schemas/EvaluationSelector" },
        head: { $ref: "#/components/schemas/EvaluationSelector" },
      },
      ["base", "head"],
    ),
    Evaluation: closedObject(
      {
        base_commit: {
          pattern: "^(?:[0-9a-f]{40}|[0-9a-f]{64})$",
          type: "string",
        },
        base_selector: { $ref: "#/components/schemas/EvaluationSelector" },
        completed_at: {
          oneOf: [{ format: "date-time", type: "string" }, { type: "null" }],
        },
        created_at: { format: "date-time", type: "string" },
        effective_outcome: {
          enum: ["pending", "clear", "advisory", "blocking", "error"],
          type: "string",
        },
        execution_status: {
          enum: ["queued", "running", "completed", "failed", "cancelled"],
          type: "string",
        },
        head_commit: {
          pattern: "^(?:[0-9a-f]{40}|[0-9a-f]{64})$",
          type: "string",
        },
        head_selector: { $ref: "#/components/schemas/EvaluationSelector" },
        id: { minLength: 1, type: "string" },
        next_attempt_at: {
          oneOf: [{ format: "date-time", type: "string" }, { type: "null" }],
        },
        provenance: { const: "explicit", type: "string" },
        repository: closedObject(
          {
            id: { minLength: 1, type: "string" },
            url: { format: "uri", pattern: "^https://", type: "string" },
          },
          ["id", "url"],
        ),
      },
      [
        "id",
        "next_attempt_at",
        "repository",
        "provenance",
        "base_selector",
        "head_selector",
        "base_commit",
        "head_commit",
        "execution_status",
        "effective_outcome",
        "created_at",
        "completed_at",
      ],
    ),
    EvaluationCollection: closedObject(
      {
        items: {
          items: { $ref: "#/components/schemas/Evaluation" },
          type: "array",
        },
        next_cursor: { type: ["string", "null"] },
      },
      ["items", "next_cursor"],
    ),
    CriterionResult: closedObject(
      {
        criterion_id: { minLength: 1, type: "string" },
        outcome: { enum: ["clear", "triggered"], type: "string" },
        review_run_id: { minLength: 1, type: "string" },
      },
      ["review_run_id", "criterion_id", "outcome"],
    ),
    FindingLocation: {
      oneOf: [
        closedObject(
          {
            end_line: { minimum: 1, type: "integer" },
            file_change_id: { minLength: 1, type: "string" },
            kind: { const: "line_range", type: "string" },
            path: { minLength: 1, type: "string" },
            side: { enum: ["base", "head"], type: "string" },
            start_line: { minimum: 1, type: "integer" },
          },
          ["kind", "file_change_id", "side", "path", "start_line", "end_line"],
        ),
        closedObject(
          {
            file_change_id: { minLength: 1, type: "string" },
            kind: { const: "whole_side", type: "string" },
            path: { minLength: 1, type: "string" },
            side: { enum: ["base", "head"], type: "string" },
          },
          ["kind", "file_change_id", "side", "path"],
        ),
        closedObject({ kind: { const: "changeset", type: "string" } }, [
          "kind",
        ]),
      ],
    },
    Finding: closedObject(
      {
        criterion_id: { minLength: 1, type: "string" },
        evidence: { minLength: 1, type: "string" },
        id: { minLength: 1, type: "string" },
        impact: { enum: ["advisory", "blocking"], type: "string" },
        location: { $ref: "#/components/schemas/FindingLocation" },
        remediation: { minLength: 1, type: "string" },
        review_run_id: { minLength: 1, type: "string" },
      },
      [
        "id",
        "review_run_id",
        "criterion_id",
        "impact",
        "evidence",
        "remediation",
        "location",
      ],
    ),
    CompletedReviewRun: closedObject(
      {
        completed_at: { format: "date-time", type: "string" },
        id: { minLength: 1, type: "string" },
        review_id: { minLength: 1, type: "string" },
        review_version_id: { minLength: 1, type: "string" },
        started_at: { format: "date-time", type: "string" },
        status: { const: "completed", type: "string" },
      },
      [
        "id",
        "review_id",
        "review_version_id",
        "status",
        "started_at",
        "completed_at",
      ],
    ),
    EvaluationResult: closedObject(
      {
        applicability_results: emptyCollection,
        completed_at: { format: "date-time", type: "string" },
        criterion_results: {
          items: { $ref: "#/components/schemas/CriterionResult" },
          type: "array",
        },
        evaluation_id: { minLength: 1, type: "string" },
        findings: {
          items: { $ref: "#/components/schemas/Finding" },
          type: "array",
        },
        outcome: {
          enum: ["clear", "advisory", "blocking", "error"],
          type: "string",
        },
        review_runs: {
          items: { $ref: "#/components/schemas/CompletedReviewRun" },
          type: "array",
        },
      },
      [
        "evaluation_id",
        "outcome",
        "completed_at",
        "applicability_results",
        "review_runs",
        "criterion_results",
        "findings",
      ],
    ),
  };
}
