import {
  authenticatedMutationHeaders,
  browserMutationHeaders,
  canonicalValidationError,
  errorResponses,
  idempotencyKeyHeader,
} from "../http-route-schema.js";

export const evaluationsSchemas = {};

export const evaluationsRoutes = [
  {
    method: "GET",
    schema: {
      ...canonicalValidationError(
        "evaluation_filter_invalid",
        "Evaluation filter is invalid",
        400,
      ),
      operationId: "listEvaluations",
      security: [
        {
          browser_session: [],
        },
        {
          implementer_token: [],
        },
      ],
      response: {
        200: {
          $ref: "EvaluationCollection#",
          description: "Newest-first Evaluations",
        },
        ...errorResponses(400, 401, 503),
      },
      querystring: {
        additionalProperties: false,
        properties: {
          cursor: {
            minLength: 1,
            type: "string",
          },
          limit: {
            maximum: 100,
            minimum: 1,
            type: "integer",
          },
          repository_id: {
            minLength: 1,
            type: "string",
          },
          execution_status: {
            enum: ["queued", "running", "completed", "failed", "cancelled"],
            type: "string",
          },
          effective_outcome: {
            enum: ["pending", "clear", "advisory", "blocking", "error"],
            type: "string",
          },
          start: {
            minimum: 0,
            type: "integer",
          },
          end: {
            minimum: 0,
            type: "integer",
          },
          query: {
            maxLength: 200,
            minLength: 1,
            type: "string",
          },
        },
        required: [],
        type: "object",
      },
    },
    url: "/api/v1/evaluations",
  },
  {
    method: "GET",
    schema: {
      operationId: "getEvaluation",
      security: [
        {
          browser_session: [],
        },
        {
          implementer_token: [],
        },
        {
          onboarding_token: [],
        },
      ],
      response: {
        200: {
          $ref: "Evaluation#",
          description: "Frozen explicit Evaluation",
        },
        ...errorResponses(400, 401, 404, 503),
      },
    },
    url: "/api/v1/evaluations/:evaluation_id",
  },
  {
    method: "GET",
    schema: {
      operationId: "getEvaluationResult",
      security: [
        {
          browser_session: [],
        },
        {
          implementer_token: [],
        },
        {
          onboarding_token: [],
        },
      ],
      response: {
        200: {
          $ref: "EvaluationResult#",
          description: "Complete immutable Evaluation Result",
        },
        ...errorResponses(400, 401, 404, 409, 503),
      },
    },
    url: "/api/v1/evaluations/:evaluation_id/result",
  },
  {
    method: "POST",
    schema: {
      headers: browserMutationHeaders(
        { "idempotency-key": idempotencyKeyHeader },
        ["idempotency-key"],
      ),
      operationId: "retryEvaluationPreStart",
      security: [
        {
          browser_session: [],
        },
      ],
      response: {
        200: {
          $ref: "Evaluation#",
          description: "Frozen explicit Evaluation",
        },
        ...errorResponses(400, 401, 403, 404, 409, 503),
      },
    },
    url: "/api/v1/evaluations/:evaluation_id/retry",
  },
  {
    method: "GET",
    schema: {
      operationId: "getEvaluationReviewRun",
      security: [
        {
          browser_session: [],
        },
        {
          implementer_token: [],
        },
      ],
      response: {
        200: {
          $ref: "ReviewRun#",
          description: "Complete canonical Review Run",
        },
        ...errorResponses(400, 401, 404, 409, 503),
      },
    },
    url: "/api/v1/evaluations/:evaluation_id/review-runs/:review_run_id",
  },
  {
    method: "GET",
    schema: {
      operationId: "getEvaluationFinding",
      security: [
        {
          browser_session: [],
        },
        {
          implementer_token: [],
        },
      ],
      response: {
        200: {
          $ref: "Finding#",
          description: "Complete canonical Finding",
        },
        ...errorResponses(400, 401, 404, 409, 503),
      },
    },
    url: "/api/v1/evaluations/:evaluation_id/findings/:finding_id",
  },
  {
    method: "POST",
    schema: {
      operationId: "cancelEvaluation",
      security: [
        {
          browser_session: [],
        },
      ],
      response: {
        200: {
          $ref: "Evaluation#",
          description: "Frozen explicit Evaluation",
        },
        ...errorResponses(400, 401, 403, 404, 409, 503),
      },
    },
    url: "/api/v1/evaluations/:evaluation_id/cancel",
  },
  {
    method: "GET",
    schema: {
      operationId: "getReviewRunDiagnostics",
      security: [
        {
          browser_session: [],
        },
      ],
      response: {
        200: {
          $ref: "ReviewRunDiagnostics#",
          description: "Operator-browser Review Run diagnostics",
        },
        ...errorResponses(400, 401, 403, 404, 503),
      },
    },
    url: "/api/v1/evaluations/:evaluation_id/review-runs/:review_run_id/diagnostics",
  },
  {
    method: "POST",
    schema: {
      ...canonicalValidationError(
        "evaluation_request_invalid",
        "Evaluation request is invalid",
        422,
      ),
      headers: authenticatedMutationHeaders(
        { "idempotency-key": idempotencyKeyHeader },
        ["idempotency-key"],
      ),
      operationId: "createExplicitEvaluation",
      security: [
        {
          browser_session: [],
        },
        {
          implementer_token: [],
        },
        {
          onboarding_token: [],
        },
      ],
      response: {
        201: {
          $ref: "Evaluation#",
          description: "Frozen explicit Evaluation",
        },
        ...errorResponses(400, 401, 403, 404, 409, 422, 503),
      },
      body: {
        $ref: "ExplicitEvaluationRequest#",
      },
    },
    url: "/api/v1/repositories/:repository_id/evaluations",
  },
];
