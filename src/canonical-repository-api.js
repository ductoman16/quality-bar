/** @param {object[]} mutationParameters @param {object} errorResponse */
export function canonicalRepositoryPath(mutationParameters, errorResponse) {
  return {
    "/api/v1/repositories": {
      get: {
        operationId: "listGenericRepositories",
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  additionalProperties: false,
                  properties: {
                    repositories: {
                      items: { $ref: "#/components/schemas/Repository" },
                      type: "array",
                    },
                  },
                  required: ["repositories"],
                  type: "object",
                },
              },
            },
            description:
              "Registered Generic HTTPS Repositories with rotatable credentials",
          },
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          500: errorResponse,
          503: errorResponse,
        },
        security: [{ browser_session: [] }],
      },
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
    "/api/v1/repositories/{repository_id}/credential/rotate": {
      post: {
        operationId: "rotateGenericRepositoryCredential",
        parameters: [
          {
            in: "path",
            name: "repository_id",
            required: true,
            schema: { minLength: 1, type: "string" },
          },
          ...mutationParameters,
        ],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/GenericRepositoryCredentialRotationRequest",
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
            description: "Repository with its verified replacement credential",
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
    "/api/v1/repositories/{repository_id}/guidance": {
      get: {
        operationId: "getRepositoryGuidance",
        parameters: [
          {
            in: "path",
            name: "repository_id",
            required: true,
            schema: { minLength: 1, type: "string" },
          },
          {
            in: "header",
            name: "If-None-Match",
            required: false,
            schema: { type: "string" },
          },
        ],
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/RepositoryGuidance",
                },
              },
            },
            description: "Complete current Repository Guidance",
            headers: {
              ETag: {
                schema: { type: "string" },
              },
            },
          },
          304: { description: "Repository Guidance is unchanged" },
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          404: errorResponse,
          500: errorResponse,
          503: errorResponse,
        },
        security: [{ browser_session: [] }],
      },
    },
    "/api/v1/repositories/{repository_id}/lifecycle": {
      patch: {
        operationId: "setRepositoryLifecycle",
        parameters: [
          {
            in: "path",
            name: "repository_id",
            required: true,
            schema: { minLength: 1, type: "string" },
          },
          ...mutationParameters,
        ],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/RepositoryLifecycleRequest",
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
            description:
              "Repository with separate operator lifecycle and observed health",
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
