import {
  canonicalValidationError,
  errorResponses,
} from "../http-route-schema.js";

export const githubSchemas = {
  GetGitHubConnection200Response: {
    anyOf: [
      {
        $ref: "GitHubConnection#",
      },
      {
        type: "null",
      },
    ],
  },
  SelectGitHubRepositories201Response: {
    items: {
      $ref: "Repository#",
    },
    minItems: 1,
    type: "array",
  },
  ConsumeGitHubCallbackFailure200Response: {
    anyOf: [
      {
        $ref: "GitHubCallbackFailure#",
      },
      {
        type: "null",
      },
    ],
  },
};

export const githubRoutes = [
  {
    method: "GET",
    schema: {
      operationId: "getGitHubConnection",
      security: [
        {
          browser_session: [],
        },
      ],
      response: {
        200: {
          $ref: "GetGitHubConnection200Response#",
          description: "The single verified personal GitHub Connection",
        },
        ...errorResponses(400, 401, 403, 500, 503),
      },
    },
    url: "/api/v1/github-connections",
  },
  {
    ...canonicalValidationError(
      "request_malformed",
      "Request is malformed",
      400,
    ),
    method: "POST",
    schema: {
      operationId: "startGitHubAppManifest",
      security: [
        {
          browser_session: [],
        },
      ],
      response: {
        200: {
          $ref: "GitHubManifestStart#",
          description: "Exact private personal-account App Manifest form",
        },
        ...errorResponses(400, 401, 403, 409, 422, 500, 503),
      },
      body: {
        $ref: "DeleteNeverUsedRepositoryRequest#",
      },
    },
    url: "/api/v1/github-connections/manifest",
  },
  {
    ...canonicalValidationError(
      "github_connection_lifecycle_request_invalid",
      "GitHub Connection lifecycle request must retire the Connection",
      422,
    ),
    method: "PATCH",
    schema: {
      operationId: "retireGitHubConnection",
      security: [
        {
          browser_session: [],
        },
      ],
      response: {
        200: {
          $ref: "GitHubConnection#",
          description: "Retired Connection with its credential destroyed",
        },
        ...errorResponses(400, 401, 403, 404, 409, 422, 500, 503),
      },
      body: {
        $ref: "GitHubConnectionRetirementRequest#",
      },
    },
    url: "/api/v1/github-connections/lifecycle",
  },
  {
    ...canonicalValidationError(
      "request_malformed",
      "Request is malformed",
      400,
    ),
    method: "DELETE",
    schema: {
      operationId: "deleteNeverUsedGitHubConnection",
      security: [
        {
          browser_session: [],
        },
      ],
      response: {
        200: {
          type: "null",
          description: "Never-used Connection deleted",
        },
        ...errorResponses(400, 401, 403, 404, 409, 422, 500, 503),
      },
      body: {
        $ref: "DeleteNeverUsedRepositoryRequest#",
      },
    },
    url: "/api/v1/github-connections/lifecycle",
  },
  {
    ...canonicalValidationError(
      "github_connection_reactivation_request_invalid",
      "GitHub Connection reactivation requires one replacement private key",
      422,
    ),
    method: "POST",
    schema: {
      operationId: "reactivateGitHubConnection",
      security: [
        {
          browser_session: [],
        },
      ],
      response: {
        200: {
          $ref: "GitHubConnection#",
          description:
            "Reactivated Connection with a newly verified private key",
        },
        ...errorResponses(400, 401, 403, 404, 409, 422, 500, 503),
      },
      body: {
        $ref: "GitHubConnectionReactivationRequest#",
      },
    },
    url: "/api/v1/github-connections/reactivate",
  },
  {
    ...canonicalValidationError(
      "github_repository_selection_invalid",
      "GitHub Repository selection must contain unique stable Repository IDs",
      422,
    ),
    method: "POST",
    schema: {
      operationId: "selectGitHubRepositories",
      security: [
        {
          browser_session: [],
        },
      ],
      response: {
        201: {
          $ref: "SelectGitHubRepositories201Response#",
          description: "Atomically verified and registered Repositories",
        },
        ...errorResponses(400, 401, 403, 409, 422, 500, 503),
      },
      body: {
        $ref: "GitHubRepositorySelectionRequest#",
      },
    },
    url: "/api/v1/github-connections/repositories",
  },
  {
    ...canonicalValidationError(
      "github_connection_rotation_request_invalid",
      "GitHub App credential rotation request is invalid",
      422,
    ),
    method: "POST",
    schema: {
      operationId: "rotateGitHubConnectionCredentials",
      security: [
        {
          browser_session: [],
        },
      ],
      response: {
        200: {
          $ref: "GitHubConnection#",
          description: "GitHub Connection after atomic credential rotation",
        },
        ...errorResponses(400, 401, 403, 404, 409, 422, 500, 503),
      },
      body: {
        $ref: "GitHubConnectionCredentialRotationRequest#",
      },
    },
    url: "/api/v1/github-connections/credential/rotate",
  },
  {
    method: "GET",
    schema: {
      operationId: "consumeGitHubCallbackFailure",
      security: [
        {
          browser_session: [],
        },
      ],
      response: {
        200: {
          $ref: "ConsumeGitHubCallbackFailure200Response#",
          description: "One-time exact callback failure or no stale result",
        },
        ...errorResponses(400, 401, 403, 500, 503),
      },
      querystring: {
        additionalProperties: false,
        properties: {
          receipt: {
            pattern: "^[A-Za-z0-9_-]{8,256}$",
            type: "string",
          },
        },
        required: ["receipt"],
        type: "object",
      },
    },
    url: "/api/v1/github-connections/callback-error",
  },
  {
    method: "GET",
    schema: {
      operationId: "completeGitHubAppManifest",
      security: [],
      response: {
        303: {
          type: "null",
          description:
            "Continue to App installation or return one failure receipt",
        },
        ...errorResponses(500),
      },
      querystring: {
        additionalProperties: false,
        properties: {
          code: {
            minLength: 1,
            type: "string",
          },
          state: {
            minLength: 8,
            type: "string",
          },
        },
        required: ["code", "state"],
        type: "object",
      },
    },
    url: "/api/v1/github-connections/manifest/callback",
  },
  {
    method: "GET",
    schema: {
      operationId: "completeGitHubAppInstallation",
      security: [],
      response: {
        303: {
          type: "null",
          description: "Return one verified Connection or one failure receipt",
        },
        ...errorResponses(500),
      },
      querystring: {
        additionalProperties: false,
        properties: {
          installation_id: {
            pattern: "^[1-9][0-9]*$",
            type: "string",
          },
          setup_action: {
            const: "install",
            type: "string",
          },
          state: {
            minLength: 8,
            type: "string",
          },
        },
        required: ["installation_id", "setup_action", "state"],
        type: "object",
      },
    },
    url: "/api/v1/github-connections/setup",
  },
];
