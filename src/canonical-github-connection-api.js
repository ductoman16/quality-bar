/** @param {object[]} mutationParameters @param {object} errorResponse */
export function canonicalGitHubConnectionPaths(
  mutationParameters,
  errorResponse,
) {
  return {
    "/api/v1/github-connections": {
      get: {
        operationId: "getGitHubConnection",
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  anyOf: [
                    { $ref: "#/components/schemas/GitHubConnection" },
                    { type: "null" },
                  ],
                },
              },
            },
            description: "The single verified personal GitHub Connection",
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
    "/api/v1/github-connections/manifest": {
      post: {
        operationId: "startGitHubAppManifest",
        parameters: mutationParameters,
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
                schema: {
                  $ref: "#/components/schemas/GitHubManifestStart",
                },
              },
            },
            description: "Exact private personal-account App Manifest form",
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
    "/api/v1/github-connections/manifest/callback": {
      get: {
        operationId: "completeGitHubAppManifest",
        parameters: [
          {
            in: "query",
            name: "code",
            required: true,
            schema: { minLength: 1, type: "string" },
          },
          {
            in: "query",
            name: "state",
            required: true,
            schema: { minLength: 8, type: "string" },
          },
        ],
        responses: {
          303: {
            description: "Continue to the exact created App installation",
          },
          400: errorResponse,
          422: errorResponse,
          500: errorResponse,
          503: errorResponse,
        },
        security: [],
      },
    },
    "/api/v1/github-connections/setup": {
      get: {
        operationId: "completeGitHubAppInstallation",
        parameters: [
          {
            in: "query",
            name: "installation_id",
            required: true,
            schema: { pattern: "^[1-9][0-9]*$", type: "string" },
          },
          {
            in: "query",
            name: "setup_action",
            required: true,
            schema: { const: "install", type: "string" },
          },
          {
            in: "query",
            name: "state",
            required: true,
            schema: { minLength: 8, type: "string" },
          },
        ],
        responses: {
          303: {
            description: "Verified GitHub Connection stored atomically",
          },
          400: errorResponse,
          409: errorResponse,
          422: errorResponse,
          500: errorResponse,
          503: errorResponse,
        },
        security: [],
      },
    },
  };
}
