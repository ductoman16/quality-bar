/** @param {object[]} mutationParameters @param {object} errorResponse */
export function canonicalRepositoryPath(mutationParameters, errorResponse) {
  return {
    "/api/v1/repositories": {
      post: {
        operationId: "registerGenericRepository",
        parameters: mutationParameters,
        requestBody: {
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/GenericRepositoryRegistrationRequest",
              },
            },
          },
          required: true,
        },
        responses: {
          200: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Repository" },
              },
            },
            description: "Verified Generic HTTPS Repository",
          },
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
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
