/** @param {object} errorResponse */
export function canonicalEvaluationPaths(errorResponse) {
  const authenticated = [{ browser_session: [] }, { implementer_token: [] }];
  const evaluationResponse = {
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/Evaluation" },
      },
    },
    description: "Frozen explicit Evaluation",
  };
  const identityParameter = {
    in: "path",
    name: "evaluation_id",
    required: true,
    schema: { minLength: 1, type: "string" },
  };
  /** @param {string} name */
  const relatedIdentityParameter = (name) => ({
    in: "path",
    name,
    required: true,
    schema: { minLength: 1, type: "string" },
  });
  /**
   * @param {string} operationId
   * @param {string} schema
   * @param {string} description
   * @param {string} parameter
   */
  const relatedRead = (operationId, schema, description, parameter) => ({
    get: {
      operationId,
      parameters: [identityParameter, relatedIdentityParameter(parameter)],
      responses: {
        200: {
          content: {
            "application/json": {
              schema: { $ref: `#/components/schemas/${schema}` },
            },
          },
          description,
        },
        400: errorResponse,
        401: errorResponse,
        404: errorResponse,
        409: errorResponse,
        503: errorResponse,
      },
      security: authenticated,
    },
  });
  /**
   * @param {string} operationId
   * @param {string} schema
   * @param {string} description
   * @param {string} parameter
   */
  const addressableRead = (operationId, schema, description, parameter) => ({
    get: {
      operationId,
      parameters: [relatedIdentityParameter(parameter)],
      responses: {
        200: {
          content: {
            "application/json": {
              schema: { $ref: `#/components/schemas/${schema}` },
            },
          },
          description,
        },
        400: errorResponse,
        401: errorResponse,
        404: errorResponse,
        503: errorResponse,
      },
      security: authenticated,
    },
  });
  return {
    "/api/v1/evaluations": {
      get: {
        operationId: "listEvaluations",
        parameters: [
          {
            in: "query",
            name: "cursor",
            schema: { minLength: 1, type: "string" },
          },
          {
            in: "query",
            name: "limit",
            schema: {
              maximum: 100,
              minimum: 1,
              type: "integer",
            },
          },
        ],
        responses: {
          200: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/EvaluationCollection" },
              },
            },
            description: "Newest-first Evaluations",
          },
          400: errorResponse,
          401: errorResponse,
          503: errorResponse,
        },
        security: authenticated,
      },
    },
    "/api/v1/evaluations/{evaluation_id}": {
      get: {
        operationId: "getEvaluation",
        parameters: [identityParameter],
        responses: {
          200: evaluationResponse,
          400: errorResponse,
          401: errorResponse,
          404: errorResponse,
          503: errorResponse,
        },
        security: authenticated,
      },
    },
    "/api/v1/evaluations/{evaluation_id}/result": {
      get: {
        operationId: "getEvaluationResult",
        parameters: [identityParameter],
        responses: {
          200: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/EvaluationResult" },
              },
            },
            description: "Complete immutable Evaluation Result",
          },
          400: errorResponse,
          401: errorResponse,
          404: errorResponse,
          409: errorResponse,
          503: errorResponse,
        },
        security: authenticated,
      },
    },
    "/api/v1/evaluations/{evaluation_id}/waiver-adjudications": {
      post: {
        operationId: "submitWaiverBatch",
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
        requestBody: {
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/WaiverBatchRequest" },
            },
          },
          required: true,
        },
        responses: {
          201: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/WaiverBatch" },
              },
            },
            description: "Atomic Waiver Request batch and queued Adjudication",
          },
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          404: errorResponse,
          409: errorResponse,
          422: errorResponse,
          503: errorResponse,
        },
        security: authenticated,
      },
    },
    "/api/v1/evaluations/{evaluation_id}/waiver-adjudications/error-retries": {
      post: {
        operationId: "retryWaiverErrors",
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
        requestBody: {
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/WaiverErrorRetryRequest",
              },
            },
          },
          required: true,
        },
        responses: {
          201: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/WaiverBatch" },
              },
            },
            description:
              "Later Adjudication over existing errored Waiver Requests",
          },
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          404: errorResponse,
          409: errorResponse,
          422: errorResponse,
          503: errorResponse,
        },
        security: [{ browser_session: [] }],
      },
    },
    "/api/v1/waiver-requests/{waiver_request_id}": addressableRead(
      "getWaiverRequest",
      "WaiverRequest",
      "Complete immutable Waiver Request",
      "waiver_request_id",
    ),
    "/api/v1/waiver-adjudications/{waiver_adjudication_id}": addressableRead(
      "getWaiverAdjudication",
      "WaiverAdjudication",
      "Current canonical Waiver Adjudication",
      "waiver_adjudication_id",
    ),
    "/api/v1/waiver-decisions/{waiver_decision_id}": addressableRead(
      "getWaiverDecision",
      "WaiverDecision",
      "Complete immutable Waiver Decision",
      "waiver_decision_id",
    ),
    "/api/v1/evaluations/{evaluation_id}/review-runs/{review_run_id}":
      relatedRead(
        "getEvaluationReviewRun",
        "ReviewRun",
        "Complete canonical Review Run",
        "review_run_id",
      ),
    "/api/v1/evaluations/{evaluation_id}/findings/{finding_id}": relatedRead(
      "getEvaluationFinding",
      "Finding",
      "Complete canonical Finding",
      "finding_id",
    ),
    "/api/v1/evaluations/{evaluation_id}/cancel": {
      post: {
        operationId: "cancelEvaluation",
        parameters: [identityParameter],
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
    },
    "/api/v1/evaluations/{evaluation_id}/review-runs/{review_run_id}/diagnostics":
      {
        get: {
          operationId: "getReviewRunDiagnostics",
          parameters: [
            identityParameter,
            {
              in: "path",
              name: "review_run_id",
              required: true,
              schema: { minLength: 1, type: "string" },
            },
          ],
          responses: {
            200: {
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ReviewRunDiagnostics",
                  },
                },
              },
              description: "Operator-browser Review Run diagnostics",
            },
            400: errorResponse,
            401: errorResponse,
            403: errorResponse,
            404: errorResponse,
            503: errorResponse,
          },
          security: [{ browser_session: [] }],
        },
      },
    "/api/v1/repositories/{repository_id}/evaluations": {
      post: {
        operationId: "createExplicitEvaluation",
        parameters: [
          {
            in: "path",
            name: "repository_id",
            required: true,
            schema: { minLength: 1, type: "string" },
          },
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
        requestBody: {
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/ExplicitEvaluationRequest",
              },
            },
          },
          required: true,
        },
        responses: {
          201: evaluationResponse,
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          404: errorResponse,
          409: errorResponse,
          422: errorResponse,
          503: errorResponse,
        },
        security: authenticated,
      },
    },
  };
}
