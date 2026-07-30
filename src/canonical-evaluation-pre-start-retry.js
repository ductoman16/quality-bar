export const evaluationPreStartRetryProperties = {
  exhausted_at: {
    oneOf: [{ format: "date-time", type: "string" }, { type: "null" }],
  },
  pre_start_attempt_count: { minimum: 0, type: "integer" },
  retry_error: {
    oneOf: [
      { $ref: "#/components/schemas/WaiverOperationalError" },
      { type: "null" },
    ],
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

/**
 * @param {object} errorResponse
 * @param {object} evaluationResponse
 * @param {object} identityParameter
 */
export function canonicalEvaluationPreStartRetryOperation(
  errorResponse,
  evaluationResponse,
  identityParameter,
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
