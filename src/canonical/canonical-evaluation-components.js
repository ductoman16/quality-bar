import { closedObject } from "./canonical-schema.js";
import { canonicalEvaluationMonitorSchemas } from "./canonical-evaluation-monitor-components.js";
import { canonicalEvaluationSelectorSchemas } from "./canonical-evaluation-selector-components.js";
import { canonicalApplicabilitySchemas } from "./canonical-applicability-components.js";
import {
  GITHUB_DELIVERY_REQUIRED,
  canonicalGitHubDeliveryProperties,
  canonicalGitHubFeedbackSchemas,
} from "./canonical-github-feedback-components.js";
import { canonicalReviewRunSchemas } from "./canonical-review-run-components.js";
import { canonicalWaiverSchemas } from "./canonical-waiver-components.js";
import {
  evaluationPreStartRetryProperties,
  evaluationPreStartRetryRequired,
} from "./canonical-evaluation-pre-start-retry.js";

export function canonicalEvaluationSchemas() {
  return {
    ...canonicalApplicabilitySchemas(),
    ...canonicalGitHubFeedbackSchemas(),
    ...canonicalReviewRunSchemas(),
    ...canonicalWaiverSchemas(),
    ...canonicalEvaluationMonitorSchemas(),
    ...canonicalEvaluationSelectorSchemas(),
    ExplicitEvaluationRequest: closedObject(
      {
        base: { $ref: "EvaluationSelector#" },
        head: { $ref: "EvaluationSelector#" },
      },
      ["base", "head"],
    ),
    Evaluation: closedObject(
      {
        base_commit: {
          pattern: "^(?:[0-9a-f]{40}|[0-9a-f]{64})$",
          type: "string",
        },
        base_selector: { $ref: "EvaluationSelector#" },
        completed_at: {
          oneOf: [{ format: "date-time", type: "string" }, { type: "null" }],
        },
        commit_status: closedObject(
          {
            ...canonicalGitHubDeliveryProperties(),
            context: { const: "Quality Bar", type: "string" },
            error: {
              oneOf: [
                closedObject(
                  {
                    code: {
                      pattern: "^[a-z][a-z0-9_]*$",
                      type: "string",
                    },
                    detail: { minLength: 1, type: "string" },
                  },
                  ["code", "detail"],
                ),
                { type: "null" },
              ],
            },
            head_commit: {
              pattern: "^(?:[0-9a-f]{40}|[0-9a-f]{64})$",
              type: "string",
            },
            external_id: {
              oneOf: [{ minimum: 1, type: "integer" }, { type: "null" }],
            },
            publication_status: {
              enum: ["waiting", "succeeded", "unavailable"],
              type: "string",
            },
            published_at: {
              oneOf: [
                { format: "date-time", type: "string" },
                { type: "null" },
              ],
            },
            state: {
              enum: ["pending", "success", "failure", "error"],
              type: "string",
            },
          },
          [
            ...GITHUB_DELIVERY_REQUIRED,
            "context",
            "external_id",
            "head_commit",
            "state",
            "publication_status",
            "published_at",
            "error",
          ],
        ),
        created_at: { format: "date-time", type: "string" },
        ...evaluationPreStartRetryProperties,
        effective_outcome: {
          enum: ["pending", "clear", "advisory", "blocking", "error"],
          type: "string",
        },
        execution_status: {
          enum: ["queued", "running", "completed", "failed", "cancelled"],
          type: "string",
        },
        feedback: {
          $ref: "GitHubEvaluationFeedback#",
        },
        head_commit: {
          pattern: "^(?:[0-9a-f]{40}|[0-9a-f]{64})$",
          type: "string",
        },
        head_selector: { $ref: "EvaluationSelector#" },
        monitor: { $ref: "EvaluationMonitor#" },
        id: { minLength: 1, type: "string" },
        next_attempt_at: {
          oneOf: [{ format: "date-time", type: "string" }, { type: "null" }],
        },
        provenance: {
          enum: ["automatic", "explicit"],
          type: "string",
        },
        pull_request: closedObject(
          {
            number: { minimum: 1, type: "integer" },
          },
          ["number"],
        ),
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
        ...evaluationPreStartRetryRequired,
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
        "monitor",
      ],
    ),
    EvaluationCollection: closedObject(
      {
        items: {
          items: { $ref: "Evaluation#" },
          type: "array",
        },
        next_cursor: { type: ["string", "null"] },
      },
      ["items", "next_cursor"],
    ),
    CriterionResult: {
      oneOf: [
        ...["clear", "triggered", "not_applicable"].map((outcome) =>
          closedObject(
            {
              criterion_id: { minLength: 1, type: "string" },
              outcome: { const: outcome, type: "string" },
              review_run_id: { minLength: 1, type: "string" },
            },
            ["review_run_id", "criterion_id", "outcome"],
          ),
        ),
        closedObject(
          {
            criterion_id: { minLength: 1, type: "string" },
            error: closedObject(
              {
                code: {
                  pattern: "^[a-z][a-z0-9_]*$",
                  type: "string",
                },
                detail: { minLength: 1, type: "string" },
              },
              ["code", "detail"],
            ),
            outcome: { const: "error", type: "string" },
            review_run_id: { minLength: 1, type: "string" },
          },
          ["review_run_id", "criterion_id", "outcome", "error"],
        ),
      ],
    },
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
        location: { $ref: "FindingLocation#" },
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
    EvaluationFileChange: closedObject(
      {
        added: { type: "boolean" },
        after_path: { type: ["string", "null"] },
        before_path: { type: ["string", "null"] },
        deleted: { type: "boolean" },
        id: { minLength: 1, type: "string" },
        modified: { type: "boolean" },
        patch: { type: "string" },
        renamed: { type: "boolean" },
      },
      [
        "id",
        "added",
        "deleted",
        "modified",
        "renamed",
        "before_path",
        "after_path",
        "patch",
      ],
    ),
    ReviewRunTranscriptChunk: closedObject(
      {
        content: { minLength: 1, type: "string" },
        sequence: { minimum: 1, type: "integer" },
        stream: { enum: ["stdout", "stderr"], type: "string" },
      },
      ["sequence", "stream", "content"],
    ),
    ReviewRunDiagnostics: closedObject(
      {
        codex_cli_version: {
          oneOf: [{ minLength: 1, type: "string" }, { type: "null" }],
        },
        completed_at: {
          oneOf: [{ format: "date-time", type: "string" }, { type: "null" }],
        },
        duration_ms: {
          oneOf: [{ minimum: 0, type: "integer" }, { type: "null" }],
        },
        process: {
          oneOf: [
            closedObject(
              {
                code: { minimum: 0, type: "integer" },
                kind: { const: "exit", type: "string" },
              },
              ["kind", "code"],
            ),
            closedObject(
              {
                kind: { const: "signal", type: "string" },
                signal: { minLength: 1, type: "string" },
              },
              ["kind", "signal"],
            ),
            closedObject({ kind: { const: "unavailable", type: "string" } }, [
              "kind",
            ]),
          ],
        },
        review_run_id: { minLength: 1, type: "string" },
        started_at: {
          oneOf: [{ format: "date-time", type: "string" }, { type: "null" }],
        },
        token_counters: closedObject(
          {
            cached_input_tokens: {
              oneOf: [{ minimum: 0, type: "integer" }, { type: "null" }],
            },
            input_tokens: {
              oneOf: [{ minimum: 0, type: "integer" }, { type: "null" }],
            },
            output_tokens: {
              oneOf: [{ minimum: 0, type: "integer" }, { type: "null" }],
            },
          },
          ["input_tokens", "cached_input_tokens", "output_tokens"],
        ),
        transcript_chunks: {
          items: { $ref: "ReviewRunTranscriptChunk#" },
          type: "array",
        },
      },
      [
        "review_run_id",
        "codex_cli_version",
        "started_at",
        "completed_at",
        "duration_ms",
        "process",
        "token_counters",
        "transcript_chunks",
      ],
    ),
    EvaluationResult: closedObject(
      {
        applicability_results: {
          items: { $ref: "ApplicabilityResult#" },
          type: "array",
        },
        completed_at: { format: "date-time", type: "string" },
        criterion_results: {
          items: { $ref: "CriterionResult#" },
          type: "array",
        },
        evaluation_id: { minLength: 1, type: "string" },
        file_changes: {
          items: { $ref: "EvaluationFileChange#" },
          type: "array",
        },
        findings: {
          items: { $ref: "Finding#" },
          type: "array",
        },
        outcome: {
          enum: ["clear", "advisory", "blocking", "error"],
          type: "string",
        },
        review_runs: {
          items: { $ref: "TerminalReviewRun#" },
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
        "file_changes",
        "findings",
      ],
    ),
  };
}
