import { closedObject, withValidationError } from "./schema.js";
import { EVALUATION_CANCELLATION_CODES } from "../evaluation/evaluation-cancellation-reason.js";

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

export function canonicalReviewRunSchemas() {
  const nullableTimestamp = {
    oneOf: [{ format: "date-time", type: "string" }, { type: "null" }],
  };
  const nullableCounter = {
    oneOf: [{ minimum: 0, type: "integer" }, { type: "null" }],
  };
  const measurements = closedObject(
    {
      codex_cli_version: {
        oneOf: [{ minLength: 1, type: "string" }, { type: "null" }],
      },
      duration_ms: nullableCounter,
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
      token_counters: closedObject(
        {
          cached_input_tokens: nullableCounter,
          input_tokens: nullableCounter,
          output_tokens: nullableCounter,
        },
        ["input_tokens", "cached_input_tokens", "output_tokens"],
      ),
    },
    ["codex_cli_version", "duration_ms", "process", "token_counters"],
  );
  const properties = {
    completed_at: nullableTimestamp,
    created_at: { format: "date-time", type: "string" },
    criterion_results: {
      items: { $ref: "CriterionResult#" },
      type: "array",
    },
    evaluation_id: { minLength: 1, type: "string" },
    findings: {
      items: { $ref: "Finding#" },
      type: "array",
    },
    id: { minLength: 1, type: "string" },
    measurements,
    review_id: { minLength: 1, type: "string" },
    review_version_id: { minLength: 1, type: "string" },
    started_at: nullableTimestamp,
  };
  const required = [
    "id",
    "evaluation_id",
    "review_id",
    "review_version_id",
    "execution_status",
    "created_at",
    "started_at",
    "completed_at",
    "measurements",
    "criterion_results",
    "findings",
  ];
  const error = closedObject(
    {
      code: { pattern: "^[a-z][a-z0-9_]*$", type: "string" },
      detail: { minLength: 1, type: "string" },
    },
    ["code", "detail"],
  );

  return {
    QueuedReviewRun: closedObject(
      {
        ...properties,
        completed_at: { type: "null" },
        execution_status: { const: "queued", type: "string" },
        started_at: { type: "null" },
      },
      required,
    ),
    RunningReviewRun: closedObject(
      {
        ...properties,
        completed_at: { type: "null" },
        execution_status: { const: "running", type: "string" },
        started_at: { format: "date-time", type: "string" },
      },
      required,
    ),
    CompletedReviewRun: closedObject(
      {
        ...properties,
        completed_at: { format: "date-time", type: "string" },
        execution_status: { const: "completed", type: "string" },
        started_at: { format: "date-time", type: "string" },
      },
      required,
    ),
    FailedReviewRun: closedObject(
      {
        ...properties,
        completed_at: { format: "date-time", type: "string" },
        error,
        execution_status: { const: "failed", type: "string" },
        started_at: { format: "date-time", type: "string" },
      },
      [...required, "error"],
    ),
    CancelledReviewRun: closedObject(
      {
        ...properties,
        completed_at: { format: "date-time", type: "string" },
        error: closedObject(
          {
            code: {
              enum: EVALUATION_CANCELLATION_CODES,
              type: "string",
            },
            detail: { minLength: 1, type: "string" },
          },
          ["code", "detail"],
        ),
        execution_status: { const: "cancelled", type: "string" },
      },
      [...required, "error"],
    ),
    ReviewRun: {
      oneOf: [
        { $ref: "QueuedReviewRun#" },
        { $ref: "RunningReviewRun#" },
        { $ref: "CompletedReviewRun#" },
        { $ref: "FailedReviewRun#" },
        { $ref: "CancelledReviewRun#" },
      ],
    },
    TerminalReviewRun: {
      oneOf: [
        { $ref: "CompletedReviewRun#" },
        { $ref: "FailedReviewRun#" },
        { $ref: "CancelledReviewRun#" },
      ],
    },
  };
}

export function canonicalWaiverAdjudicatorConfigurationSchemas() {
  return {
    WaiverAdjudicatorConfigurationState: {
      oneOf: [
        closedObject({ configured: { const: false, type: "boolean" } }, [
          "configured",
        ]),
        closedObject(
          {
            configuration: { $ref: "CodexConfiguration#" },
            configured: { const: true, type: "boolean" },
          },
          ["configured", "configuration"],
        ),
      ],
    },
    WaiverAdjudicatorConfigurationChange: closedObject(
      {
        changed: { type: "boolean" },
        configuration: { $ref: "CodexConfiguration#" },
      },
      ["changed", "configuration"],
    ),
  };
}

export function canonicalWaiverFollowupSchemas() {
  const identifier = { minLength: 1, type: "string" };
  const nullValue = { type: "null" };
  const nullableTimestamp = {
    oneOf: [{ format: "date-time", type: "string" }, nullValue],
  };
  const nullableError = {
    oneOf: [{ $ref: "WaiverOperationalError#" }, nullValue],
  };
  return {
    WaiverFollowupAttempt: closedObject(
      {
        attempt_count: { minimum: 0, type: "integer" },
        error: nullableError,
        last_attempt_at: nullableTimestamp,
        next_attempt_at: nullableTimestamp,
        reconciliation_required: { type: "boolean" },
      },
      [
        "attempt_count",
        "error",
        "last_attempt_at",
        "next_attempt_at",
        "reconciliation_required",
      ],
    ),
    WaiverFollowupSurface: closedObject(
      {
        error: nullableError,
        latest_attempt: {
          oneOf: [{ $ref: "WaiverFollowupAttempt#" }, nullValue],
        },
        publication_status: {
          enum: ["waiting", "succeeded", "unavailable"],
          type: "string",
        },
      },
      ["publication_status", "error", "latest_attempt"],
    ),
    WaiverLocalFollowupSurface: closedObject(
      {
        decision_id: identifier,
        error: nullableError,
        latest_attempt: {
          oneOf: [{ $ref: "WaiverFollowupAttempt#" }, nullValue],
        },
        publication_status: {
          enum: ["waiting", "succeeded", "unavailable"],
          type: "string",
        },
      },
      ["decision_id", "publication_status", "error", "latest_attempt"],
    ),
    WaiverFollowupPublication: closedObject(
      {
        aggregate: { $ref: "WaiverFollowupSurface#" },
        local: {
          items: { $ref: "WaiverLocalFollowupSurface#" },
          type: "array",
        },
      },
      ["aggregate", "local"],
    ),
  };
}

const waiverAdjudicationProperties = {
  base_commit: {
    pattern: "^(?:[0-9a-f]{40}|[0-9a-f]{64})$",
    type: "string",
  },
  completed_at: { format: "date-time", type: ["string", "null"] },
  configuration: { $ref: "CodexConfiguration#" },
  created_at: { format: "date-time", type: "string" },
  evaluation_id: { minLength: 1, type: "string" },
  head_commit: {
    pattern: "^(?:[0-9a-f]{40}|[0-9a-f]{64})$",
    type: "string",
  },
  id: { minLength: 1, type: "string" },
  request_ids: {
    items: { minLength: 1, type: "string" },
    minItems: 1,
    type: "array",
  },
  started_at: { format: "date-time", type: ["string", "null"] },
};
const waiverAdjudicationRequired = [
  "id",
  "evaluation_id",
  "base_commit",
  "head_commit",
  "request_ids",
  "configuration",
  "execution_status",
  "created_at",
];

export function canonicalWaiverSchemas() {
  const emptyDecisions = { maxItems: 0, type: "array" };
  const decisions = {
    items: { $ref: "WaiverOperationalDecision#" },
    type: "array",
  };
  const identifier = { minLength: 1, type: "string" };
  const nullValue = { type: "null" };
  const nullableTimestamp = {
    oneOf: [{ format: "date-time", type: "string" }, nullValue],
  };
  const nullableError = {
    oneOf: [{ $ref: "WaiverOperationalError#" }, { type: "null" }],
  };
  const operationalProperties = {
    completed_at: nullableTimestamp,
    decisions,
    exhausted_at: nullableTimestamp,
    execution_status: { type: "string" },
    followup: {
      oneOf: [{ $ref: "WaiverFollowupPublication#" }, nullValue],
    },
    id: identifier,
    next_attempt_at: nullableTimestamp,
    pre_start_attempt_count: { minimum: 0, type: "integer" },
    request_ids: {
      items: identifier,
      minItems: 1,
      type: "array",
      uniqueItems: true,
    },
    retry_cycle: { minimum: 1, type: "integer" },
    retry_error: nullableError,
    retry_state: { type: "string" },
    started_at: nullableTimestamp,
  };
  const operationalRequired = Object.keys(operationalProperties);
  /** @param {Record<string, any>} properties */
  const operational = (properties) =>
    closedObject(
      { ...operationalProperties, ...properties },
      operationalRequired,
    );
  return {
    ...canonicalWaiverFollowupSchemas(),
    WaiverOperationalError: closedObject(
      {
        code: {
          minLength: 1,
          pattern: "^[a-z][a-z0-9_]*$",
          type: "string",
        },
        detail: { minLength: 1, pattern: "\\S", type: "string" },
      },
      ["code", "detail"],
    ),
    WaiverAcceptedOrDeniedDecision: closedObject(
      {
        explanation: { minLength: 1, pattern: "\\S", type: "string" },
        id: identifier,
        outcome: { enum: ["accepted", "denied"], type: "string" },
        request_id: identifier,
      },
      ["id", "request_id", "outcome", "explanation"],
    ),
    WaiverErrorDecision: closedObject(
      {
        error: { $ref: "WaiverOperationalError#" },
        id: identifier,
        outcome: { const: "error", type: "string" },
        request_id: identifier,
      },
      ["id", "request_id", "outcome", "error"],
    ),
    WaiverOperationalDecision: {
      oneOf: [
        { $ref: "WaiverAcceptedOrDeniedDecision#" },
        { $ref: "WaiverErrorDecision#" },
      ],
    },
    WaiverQueuedReadyAdjudication: operational({
      completed_at: nullValue,
      decisions: emptyDecisions,
      exhausted_at: nullValue,
      execution_status: { const: "queued", type: "string" },
      next_attempt_at: { format: "date-time", type: "string" },
      retry_state: { const: "ready", type: "string" },
      started_at: nullValue,
    }),
    WaiverQueuedExhaustedAdjudication: operational({
      completed_at: nullValue,
      decisions: emptyDecisions,
      exhausted_at: { format: "date-time", type: "string" },
      execution_status: { const: "queued", type: "string" },
      next_attempt_at: nullValue,
      pre_start_attempt_count: { minimum: 1, type: "integer" },
      retry_error: { $ref: "WaiverOperationalError#" },
      retry_state: { const: "exhausted", type: "string" },
      started_at: nullValue,
    }),
    WaiverRunningAdjudication: operational({
      completed_at: nullValue,
      decisions: emptyDecisions,
      exhausted_at: nullValue,
      execution_status: { const: "running", type: "string" },
      next_attempt_at: nullValue,
      retry_state: { const: "ready", type: "string" },
      started_at: { format: "date-time", type: "string" },
    }),
    WaiverCompletedAdjudication: operational({
      completed_at: { format: "date-time", type: "string" },
      decisions: { ...decisions, minItems: 1 },
      exhausted_at: nullValue,
      execution_status: { const: "completed", type: "string" },
      next_attempt_at: nullValue,
      retry_state: { const: "ready", type: "string" },
      started_at: { format: "date-time", type: "string" },
    }),
    WaiverFailedAdjudication: closedObject(
      {
        ...operationalProperties,
        completed_at: { format: "date-time", type: "string" },
        decisions: emptyDecisions,
        error: { $ref: "WaiverOperationalError#" },
        exhausted_at: nullValue,
        execution_status: { const: "failed", type: "string" },
        next_attempt_at: nullValue,
        retry_state: { const: "ready", type: "string" },
        started_at: { format: "date-time", type: "string" },
      },
      [...operationalRequired, "error"],
    ),
    WaiverCancelledAdjudication: operational({
      completed_at: { format: "date-time", type: "string" },
      decisions: emptyDecisions,
      exhausted_at: nullValue,
      execution_status: { const: "cancelled", type: "string" },
      next_attempt_at: nullValue,
      retry_state: { const: "ready", type: "string" },
      started_at: { format: "date-time", type: "string" },
    }),
    WaiverBatchRequestItem: closedObject(
      {
        finding_id: { minLength: 1, type: "string" },
        rationale: { minLength: 1, pattern: "\\S", type: "string" },
      },
      ["finding_id", "rationale"],
    ),
    WaiverBatchRequest: closedObject(
      {
        requests: {
          items: { $ref: "WaiverBatchRequestItem#" },
          minItems: 1,
          type: "array",
        },
      },
      ["requests"],
    ),
    WaiverErrorRetryRequest: closedObject(
      {
        request_ids: {
          items: { minLength: 1, type: "string" },
          minItems: 1,
          type: "array",
          uniqueItems: true,
        },
      },
      ["request_ids"],
    ),
    WaiverRequest: closedObject(
      {
        created_at: { format: "date-time", type: "string" },
        evaluation_id: { minLength: 1, type: "string" },
        finding_id: { minLength: 1, type: "string" },
        id: { minLength: 1, type: "string" },
        rationale: { minLength: 1, pattern: "\\S", type: "string" },
      },
      ["id", "evaluation_id", "finding_id", "rationale", "created_at"],
    ),
    WaiverAdjudication: {
      oneOf: [
        closedObject(
          {
            ...waiverAdjudicationProperties,
            execution_status: {
              enum: ["queued", "running"],
              type: "string",
            },
          },
          waiverAdjudicationRequired,
        ),
        closedObject(
          {
            ...waiverAdjudicationProperties,
            error: closedObject(
              {
                code: {
                  const: "waiver_adjudication_cancelled",
                  type: "string",
                },
                detail: {
                  const: "Waiver Adjudication was cancelled",
                  type: "string",
                },
              },
              ["code", "detail"],
            ),
            execution_status: { const: "cancelled", type: "string" },
          },
          [...waiverAdjudicationRequired, "error"],
        ),
        closedObject(
          {
            ...waiverAdjudicationProperties,
            decisions: {
              items: { $ref: "WaiverDecision#" },
              minItems: 1,
              type: "array",
            },
            execution_status: { const: "completed", type: "string" },
          },
          [...waiverAdjudicationRequired, "decisions"],
        ),
        closedObject(
          {
            ...waiverAdjudicationProperties,
            error: closedObject(
              {
                code: { minLength: 1, type: "string" },
                detail: { minLength: 1, type: "string" },
              },
              ["code", "detail"],
            ),
            execution_status: { const: "failed", type: "string" },
          },
          [...waiverAdjudicationRequired, "error"],
        ),
      ],
    },
    WaiverDecision: {
      oneOf: [
        closedObject(
          {
            created_at: { format: "date-time", type: "string" },
            explanation: { minLength: 1, pattern: "\\S", type: "string" },
            id: { minLength: 1, type: "string" },
            outcome: {
              enum: ["accepted", "denied"],
              type: "string",
            },
            request_id: { minLength: 1, type: "string" },
            waiver_adjudication_id: { minLength: 1, type: "string" },
          },
          [
            "id",
            "waiver_adjudication_id",
            "request_id",
            "outcome",
            "explanation",
            "created_at",
          ],
        ),
        closedObject(
          {
            created_at: { format: "date-time", type: "string" },
            error: closedObject(
              {
                code: { minLength: 1, type: "string" },
                detail: { minLength: 1, type: "string" },
              },
              ["code", "detail"],
            ),
            id: { minLength: 1, type: "string" },
            outcome: { const: "error", type: "string" },
            request_id: { minLength: 1, type: "string" },
            waiver_adjudication_id: { minLength: 1, type: "string" },
          },
          [
            "id",
            "waiver_adjudication_id",
            "request_id",
            "outcome",
            "error",
            "created_at",
          ],
        ),
      ],
    },
    WaiverBatch: closedObject(
      {
        adjudication: { $ref: "WaiverAdjudication#" },
        requests: {
          items: { $ref: "WaiverRequest#" },
          minItems: 1,
          type: "array",
        },
      },
      ["requests", "adjudication"],
    ),
    WaiverAdjudicationOperational: {
      oneOf: [
        { $ref: "WaiverQueuedReadyAdjudication#" },
        { $ref: "WaiverQueuedExhaustedAdjudication#" },
        { $ref: "WaiverRunningAdjudication#" },
        { $ref: "WaiverCompletedAdjudication#" },
        { $ref: "WaiverFailedAdjudication#" },
        { $ref: "WaiverCancelledAdjudication#" },
      ],
    },
    WaiverAdjudicationOperationalCollection: closedObject(
      {
        items: {
          items: {
            $ref: "WaiverAdjudicationOperational#",
          },
          type: "array",
        },
      },
      ["items"],
    ),
  };
}
