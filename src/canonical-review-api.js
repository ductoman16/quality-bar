/** @param {object[]} mutationParameters @param {object} errorResponse */
export function canonicalReviewPath(mutationParameters, errorResponse) {
  return {
    "/api/v1/reviews/{review_id}": {
      delete: {
        operationId: "deleteNeverUsedReview",
        parameters: [
          {
            in: "path",
            name: "review_id",
            required: true,
            schema: { minLength: 1, type: "string" },
          },
          ...mutationParameters,
        ],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                additionalProperties: false,
                properties: {},
                type: "object",
              },
            },
          },
          required: true,
        },
        responses: {
          200: {
            content: {
              "application/json": {
                schema: { type: "null" },
              },
            },
            description: "Complete never-used Review lineage deleted",
          },
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          404: errorResponse,
          409: errorResponse,
          422: errorResponse,
          500: errorResponse,
          503: errorResponse,
        },
        security: [{ browser_session: [] }],
      },
    },
  };
}
