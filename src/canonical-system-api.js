/** @param {object} errorResponse */
export function canonicalSystemPath(errorResponse) {
  return {
    "/api/v1/system": {
      get: {
        operationId: "getSystem",
        responses: {
          200: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/System" },
              },
            },
            description: "System facts",
          },
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          500: errorResponse,
          503: errorResponse,
        },
        security: [{ browser_session: [] }],
      },
    },
  };
}
