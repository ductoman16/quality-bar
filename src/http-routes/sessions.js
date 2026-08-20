import {
  browserMutationHeaders,
  canonicalValidationError,
  errorResponses,
} from "../http-route-schema.js";

export const sessionsSchemas = {};

export const sessionsRoutes = [
  {
    method: "POST",
    schema: {
      operationId: "loginOperator",
      security: [],
      response: {
        204: {
          type: "null",
          description: "Authenticated browser session",
        },
        ...errorResponses(400, 401, 429, 503),
      },
      body: {
        $ref: "LoginRequest#",
      },
    },
    url: "/api/v1/session/login",
  },
  {
    method: "POST",
    schema: {
      headers: browserMutationHeaders(),
      operationId: "logoutOperator",
      security: [
        {
          browser_session: [],
        },
      ],
      response: {
        204: {
          type: "null",
          description: "Current browser session revoked",
        },
        ...errorResponses(400, 401, 403, 503),
      },
    },
    url: "/api/v1/session/logout",
  },
  {
    method: "POST",
    schema: {
      headers: browserMutationHeaders(),
      operationId: "recordBrowserSessionActivity",
      security: [
        {
          browser_session: [],
        },
      ],
      response: {
        204: {
          type: "null",
          description: "Browser session refreshed",
        },
        ...errorResponses(400, 401, 403, 503),
      },
    },
    url: "/api/v1/session/activity",
  },
  {
    method: "POST",
    schema: {
      headers: browserMutationHeaders(),
      operationId: "changeOperatorPassword",
      security: [
        {
          browser_session: [],
        },
      ],
      response: {
        204: {
          type: "null",
          description: "Password changed and sessions revoked",
        },
        ...errorResponses(400, 401, 403, 422, 503),
      },
      body: {
        $ref: "PasswordChangeRequest#",
      },
    },
    url: "/api/v1/session/password",
  },
  {
    ...canonicalValidationError(
      "session_revocation_confirmation_invalid",
      "Global browser-session revocation must be confirmed",
      422,
    ),
    method: "POST",
    schema: {
      headers: browserMutationHeaders(),
      operationId: "revokeBrowserSessions",
      security: [
        {
          browser_session: [],
        },
      ],
      response: {
        204: {
          type: "null",
          description: "All browser sessions revoked",
        },
        ...errorResponses(400, 401, 403, 422, 503),
      },
      body: {
        $ref: "SessionRevocationRequest#",
      },
    },
    url: "/api/v1/sessions/revoke",
  },
  {
    method: "POST",
    schema: {
      headers: browserMutationHeaders(),
      operationId: "createImplementerToken",
      security: [
        {
          browser_session: [],
        },
      ],
      response: {
        201: {
          description: "One-time token reveal",
          additionalProperties: false,
          properties: { token: { type: "string" } },
          required: ["token"],
          type: "object",
        },
        ...errorResponses(400, 401, 403, 409, 503),
      },
      body: {
        $ref: "CurrentPasswordRequest#",
      },
    },
    url: "/api/v1/implementer-token",
  },
  {
    method: "POST",
    schema: {
      headers: browserMutationHeaders(),
      operationId: "rotateImplementerToken",
      security: [
        {
          browser_session: [],
        },
      ],
      response: {
        200: {
          description: "One-time replacement token reveal",
          additionalProperties: false,
          properties: { token: { type: "string" } },
          required: ["token"],
          type: "object",
        },
        ...errorResponses(400, 401, 403, 409, 503),
      },
      body: {
        $ref: "CurrentPasswordRequest#",
      },
    },
    url: "/api/v1/implementer-token/rotate",
  },
  {
    method: "POST",
    schema: {
      headers: browserMutationHeaders(),
      operationId: "revokeImplementerToken",
      security: [
        {
          browser_session: [],
        },
      ],
      response: {
        204: {
          type: "null",
          description: "Implementer token revoked",
        },
        ...errorResponses(400, 401, 403, 409, 503),
      },
      body: {
        $ref: "CurrentPasswordRequest#",
      },
    },
    url: "/api/v1/implementer-token/revoke",
  },
];
