/** @param {object} errorResponse */
export function canonicalEvaluationPaths(errorResponse) {
  const authenticated = [{ browser_session: [] }];
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
