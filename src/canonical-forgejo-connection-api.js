import {
  forgejoFailedVerification,
  forgejoSuccessfulVerification,
} from "./canonical-forgejo-connection-components.js";
import {
  forgejoPollingFailure,
  forgejoPollingState,
} from "./canonical-forgejo-polling-components.js";

/** @param {object[]} mutationParameters @param {object} errorResponse */
export function canonicalForgejoConnectionPaths(
  mutationParameters,
  errorResponse,
) {
  const connection = {
    additionalProperties: false,
    properties: {
      api_profile: { const: "forgejo-v16", type: "string" },
      base_url: { format: "uri", type: "string" },
      capabilities: { type: "object" },
      health: { enum: ["healthy", "error"], type: "string" },
      health_error: {
        oneOf: [
          {
            additionalProperties: false,
            properties: {
              code: { minLength: 1, type: "string" },
              message: { minLength: 1, type: "string" },
            },
            required: ["code", "message"],
            type: "object",
          },
          { type: "null" },
        ],
      },
      id: { type: "string" },
      lifecycle: { enum: ["enabled", "retired"], type: "string" },
      principal: {
        description:
          "Repository-owner identity observed through the Repository-restricted PAT",
        type: "object",
      },
      polling: { items: forgejoPollingState, type: "array" },
      polling_failure: {
        oneOf: [forgejoPollingFailure, { type: "null" }],
      },
      reported_version: { pattern: "^16\\.", type: "string" },
      scopes: {
        description:
          "Required v16 PAT authorities proven through route and capability behavior",
        items: { type: "string" },
        type: "array",
      },
      verification_history: {
        items: {
          oneOf: [forgejoSuccessfulVerification, forgejoFailedVerification],
        },
        minItems: 1,
        type: "array",
      },
      verified_at: { type: "integer" },
    },
    required: [
      "api_profile",
      "base_url",
      "capabilities",
      "health",
      "health_error",
      "id",
      "lifecycle",
      "principal",
      "polling",
      "polling_failure",
      "reported_version",
      "scopes",
      "verification_history",
      "verified_at",
    ],
    type: "object",
    oneOf: [
      {
        properties: {
          health: { const: "healthy" },
          health_error: { type: "null" },
        },
        required: ["health", "health_error"],
      },
      {
        properties: {
          health: { const: "error" },
          health_error: {
            additionalProperties: false,
            properties: {
              code: { minLength: 1, type: "string" },
              message: { minLength: 1, type: "string" },
            },
            required: ["code", "message"],
            type: "object",
          },
        },
        required: ["health", "health_error"],
      },
    ],
  };
  return {
    "/api/v1/forgejo-connections": {
      get: {
        operationId: "getForgejoConnection",
        responses: {
          200: {
            content: {
              "application/json": {
                schema: { anyOf: [connection, { type: "null" }] },
              },
            },
            description: "The single verified Forgejo v16 Connection",
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
        operationId: "verifyForgejoV16Connection",
        parameters: mutationParameters,
        requestBody: {
          content: {
            "application/json": {
              schema: {
                additionalProperties: false,
                properties: {
                  base_url: { format: "uri", type: "string" },
                  repository_ids: {
                    items: { minimum: 1, type: "integer" },
                    minItems: 1,
                    type: "array",
                    uniqueItems: true,
                  },
                  token: { minLength: 1, type: "string", writeOnly: true },
                },
                required: ["base_url", "repository_ids", "token"],
                type: "object",
              },
            },
          },
          required: true,
        },
        responses: {
          201: {
            content: { "application/json": { schema: connection } },
            description:
              "Atomically verified Forgejo Connection and selected Repositories",
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
    "/api/v1/forgejo-connections/discover": {
      post: {
        operationId: "discoverForgejoV16Repositories",
        parameters: mutationParameters,
        requestBody: {
          content: {
            "application/json": {
              schema: {
                additionalProperties: false,
                properties: {
                  base_url: { format: "uri", type: "string" },
                  token: { minLength: 1, type: "string", writeOnly: true },
                },
                required: ["base_url", "token"],
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
                  items: { type: "object" },
                  minItems: 1,
                  type: "array",
                },
              },
            },
            description:
              "Verified accessible Forgejo Repositories for explicit selection",
          },
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          422: errorResponse,
          500: errorResponse,
          503: errorResponse,
        },
        security: [{ browser_session: [] }],
      },
    },
    "/api/v1/forgejo-connections/credential/rotate": {
      post: {
        operationId: "rotateForgejoConnectionPat",
        parameters: mutationParameters,
        requestBody: {
          content: {
            "application/json": {
              schema: {
                additionalProperties: false,
                properties: {
                  token: { minLength: 1, type: "string", writeOnly: true },
                },
                required: ["token"],
                type: "object",
              },
            },
          },
          required: true,
        },
        responses: {
          200: {
            content: { "application/json": { schema: connection } },
            description:
              "Replacement Forgejo PAT verified and atomically activated",
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
    "/api/v1/forgejo-connections/lifecycle": {
      delete: {
        operationId: "deleteNeverUsedForgejoConnection",
        parameters: mutationParameters,
        requestBody: {
          content: {
            "application/json": {
              schema: {
                additionalProperties: false,
                maxProperties: 0,
                type: "object",
              },
            },
          },
          required: true,
        },
        responses: {
          200: {
            content: { "application/json": { schema: { type: "null" } } },
            description: "Never-used Forgejo Connection permanently deleted",
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
      patch: {
        operationId: "retireForgejoConnection",
        parameters: mutationParameters,
        requestBody: {
          content: {
            "application/json": {
              schema: {
                additionalProperties: false,
                properties: {
                  lifecycle: { const: "retired", type: "string" },
                },
                required: ["lifecycle"],
                type: "object",
              },
            },
          },
          required: true,
        },
        responses: {
          200: {
            content: { "application/json": { schema: connection } },
            description:
              "Forgejo Connection retired after every dependent Repository retired",
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
    "/api/v1/forgejo-connections/reactivate": {
      post: {
        operationId: "reactivateForgejoConnection",
        parameters: mutationParameters,
        requestBody: {
          content: {
            "application/json": {
              schema: {
                additionalProperties: false,
                properties: {
                  token: { minLength: 1, type: "string", writeOnly: true },
                },
                required: ["token"],
                type: "object",
              },
            },
          },
          required: true,
        },
        responses: {
          200: {
            content: { "application/json": { schema: connection } },
            description:
              "Retired Forgejo Connection completely reverified and reactivated",
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
