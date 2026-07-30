/** @param {object} errorResponse */
export function canonicalAnalyticsPath(errorResponse) {
  return {
    "/api/v1/analytics": {
      get: {
        operationId: "getAnalytics",
        responses: {
          200: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Analytics" },
              },
            },
            description: "Canonical Analytics facts",
          },
          400: errorResponse,
          401: errorResponse,
          500: errorResponse,
          503: errorResponse,
        },
        security: [{ browser_session: [] }, { implementer_token: [] }],
      },
    },
  };
}
