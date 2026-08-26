import { closedObject } from "./schema.ts";
import {
  GITHUB_DELIVERY_REQUIRED,
  canonicalGitHubDeliveryProperties,
  canonicalGitHubFeedbackSchemas,
} from "./forge.ts";
import { canonicalReviewRunSchemas, canonicalWaiverSchemas } from "./review.ts";

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
  const branchEvidence = (kind: string, minimumPredicates: boolean) =>
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
  const result = (
    outcome: string,
    resultRule: Record<string, unknown>,
    evidence: Record<string, unknown>,
  ) =>
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

export function canonicalEvaluationSelectorSchemas() {
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
  };
}

export function canonicalEvaluationMonitorSchemas() {
  return {
    EvaluationMonitorSystemNode: closedObject(
      {
        key: { enum: ["preparing", "finalizing"], type: "string" },
        kind: { const: "system", type: "string" },
        label: { enum: ["Preparing", "Finalizing"], type: "string" },
        status: {
          enum: ["queued", "running", "completed", "failed", "cancelled"],
          type: "string",
        },
      },
      ["kind", "key", "label", "status"],
    ),
    EvaluationMonitorReviewNode: closedObject(
      {
        kind: { const: "review", type: "string" },
        label: { minLength: 1, type: "string" },
        outcome: {
          oneOf: [
            {
              enum: ["clear", "advisory", "blocking", "error"],
              type: "string",
            },
            { type: "null" },
          ],
        },
        review_id: { minLength: 1, type: "string" },
        review_version_id: { minLength: 1, type: "string" },
        status: {
          enum: ["queued", "running", "completed", "failed", "cancelled"],
          type: "string",
        },
      },
      ["kind", "review_id", "review_version_id", "label", "outcome", "status"],
    ),
    EvaluationMonitor: closedObject(
      {
        duration_ms: {
          oneOf: [{ minimum: 0, type: "integer" }, { type: "null" }],
        },
        finding_counts: {
          oneOf: [
            closedObject(
              {
                advisory: { minimum: 0, type: "integer" },
                blocking: { minimum: 0, type: "integer" },
                total: { minimum: 0, type: "integer" },
              },
              ["total", "advisory", "blocking"],
            ),
            { type: "null" },
          ],
        },
        nodes: {
          items: {
            oneOf: [
              { $ref: "EvaluationMonitorSystemNode#" },
              { $ref: "EvaluationMonitorReviewNode#" },
            ],
          },
          minItems: 2,
          type: "array",
        },
        outcome_counts: {
          oneOf: [
            closedObject(
              {
                clear: { minimum: 0, type: "integer" },
                error: { minimum: 0, type: "integer" },
                not_applicable: { minimum: 0, type: "integer" },
                triggered: { minimum: 0, type: "integer" },
              },
              ["clear", "triggered", "not_applicable", "error"],
            ),
            { type: "null" },
          ],
        },
        review_counts: closedObject(
          {
            cancelled: { minimum: 0, type: "integer" },
            completed: { minimum: 0, type: "integer" },
            failed: { minimum: 0, type: "integer" },
            queued: { minimum: 0, type: "integer" },
            running: { minimum: 0, type: "integer" },
            total: { minimum: 0, type: "integer" },
          },
          ["total", "queued", "running", "completed", "failed", "cancelled"],
        ),
      },
      [
        "nodes",
        "review_counts",
        "outcome_counts",
        "finding_counts",
        "duration_ms",
      ],
    ),
  };
}

export const evaluationPreStartRetryProperties = {
  exhausted_at: {
    oneOf: [{ format: "date-time", type: "string" }, { type: "null" }],
  },
  pre_start_attempt_count: { minimum: 0, type: "integer" },
  retry_error: {
    oneOf: [{ $ref: "WaiverOperationalError#" }, { type: "null" }],
  },
  retry_state: {
    enum: ["ready", "exhausted"],
    type: "string",
  },
};

export const evaluationPreStartRetryRequired = [
  "retry_state",
  "retry_error",
  "pre_start_attempt_count",
  "exhausted_at",
];

export function canonicalEvaluationPreStartRetryOperation(
  errorResponse: object,
  evaluationResponse: object,
  identityParameter: object,
) {
  return {
    post: {
      operationId: "retryEvaluationPreStart",
      parameters: [
        identityParameter,
        {
          in: "header",
          name: "Idempotency-Key",
          required: true,
          schema: {
            maxLength: 255,
            minLength: 1,
            pattern: "^[!-~]+$",
            type: "string",
          },
        },
      ],
      responses: {
        200: evaluationResponse,
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
        503: errorResponse,
      },
      security: [{ browser_session: [] }],
    },
  };
}

export const EVALUATION_LIST_PARAMETERS = [
  {
    in: "query",
    name: "cursor",
    schema: { minLength: 1, type: "string" },
  },
  {
    in: "query",
    name: "limit",
    schema: { maximum: 100, minimum: 1, type: "integer" },
  },
  {
    in: "query",
    name: "repository_id",
    schema: { minLength: 1, type: "string" },
  },
  {
    in: "query",
    name: "execution_status",
    schema: {
      enum: ["queued", "running", "completed", "failed", "cancelled"],
      type: "string",
    },
  },
  {
    in: "query",
    name: "effective_outcome",
    schema: {
      enum: ["pending", "clear", "advisory", "blocking", "error"],
      type: "string",
    },
  },
  { in: "query", name: "start", schema: { minimum: 0, type: "integer" } },
  { in: "query", name: "end", schema: { minimum: 0, type: "integer" } },
  {
    in: "query",
    name: "query",
    schema: { maxLength: 200, minLength: 1, type: "string" },
  },
];

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
