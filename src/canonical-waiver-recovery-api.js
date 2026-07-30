/** @param {object} errorResponse */
export function canonicalWaiverRecoveryOperation(errorResponse) {
  return {
    post: {
      operationId: "recoverWaiverAdjudication",
      parameters: [
        {
          in: "path",
          name: "waiver_adjudication_id",
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
      responses: {
        200: {
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/WaiverBatch" },
            },
          },
          description: "Same-identity pre-start recovery",
        },
        201: {
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/WaiverBatch" },
            },
          },
          description:
            "Later Adjudication for a started failure or cancellation",
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
  };
}
