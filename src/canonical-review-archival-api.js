/** @param {object[]} mutationParameters @param {object} errorResponse */
export function canonicalReviewArchivalPath(mutationParameters, errorResponse) {
  return {
    "/api/v1/reviews/{review_id}/archival": {
      patch: {
        operationId: "setReviewArchived",
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
                $ref: "#/components/schemas/ReviewArchivalRequest",
              },
            },
          },
          required: true,
        },
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ReviewArchivalResult",
                },
              },
            },
            description:
              "Review archived or restored with its active version and history preserved",
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
