import {
  canonicalValidationError,
  errorResponses,
} from "../http-route-schema.ts";
import { writeError } from "../http-response.ts";

export const systemSchemas = {};

export const systemRoutes = [
  {
    method: "GET",
    schema: {
      hide: true,
      security: [{ browser_session: [] }, { implementer_token: [] }],
    },
    url: "/api/v1",
  },
  {
    method: "POST",
    onRequest(
      request: import("fastify").FastifyRequest,
      reply: import("fastify").FastifyReply,
    ) {
      void request;
      writeError(reply, 404, "not_found", "Resource was not found");
    },
    schema: {
      hide: true,
      security: [],
    },
    url: "/api/v1/operator-password/bootstrap",
  },
  {
    method: "GET",
    schema: {
      operationId: "getOpenApiDocument",
      querystring: {
        additionalProperties: false,
        properties: {},
        type: "object",
      },
      security: [
        {
          browser_session: [],
        },
        {
          implementer_token: [],
        },
      ],
      response: {
        200: {
          additionalProperties: true,
          type: "object",
          description: "OpenAPI document",
        },
        ...errorResponses(400, 401),
      },
    },
    url: "/api/v1/openapi.json",
  },
  {
    method: "GET",
    schema: {
      operationId: "listGenericRepositories",
      security: [
        {
          browser_session: [],
        },
        {
          implementer_token: [],
        },
        {
          onboarding_token: [],
        },
      ],
      response: {
        200: {
          $ref: "RepositoryCollection#",
          description:
            "Registered Generic HTTPS Repositories with rotatable credentials",
        },
        ...errorResponses(400, 401, 403, 500, 503),
      },
      querystring: {
        additionalProperties: false,
        properties: {
          cursor: {
            type: "string",
          },
          limit: {
            default: 50,
            maximum: 100,
            minimum: 1,
            type: "integer",
          },
        },
        required: [],
        type: "object",
      },
    },
    url: "/api/v1/repositories",
  },
  {
    method: "GET",
    schema: {
      operationId: "getSystem",
      security: [
        {
          browser_session: [],
        },
      ],
      response: {
        200: {
          $ref: "System#",
          description: "System facts",
        },
        ...errorResponses(400, 401, 403, 500, 503),
      },
    },
    url: "/api/v1/system",
  },
  {
    method: "GET",
    schema: {
      operationId: "getCodexExecutionConcurrency",
      security: [
        {
          browser_session: [],
        },
      ],
      response: {
        200: {
          $ref: "CodexExecutionConcurrency#",
          description: "Installation-wide Codex execution concurrency",
        },
        ...errorResponses(400, 401, 403, 422, 503),
      },
    },
    url: "/api/v1/system/codex-concurrency",
  },
  {
    method: "PATCH",
    schema: {
      ...canonicalValidationError(
        "codex_execution_concurrency_invalid",
        "Codex execution concurrency must be an integer from 1 through 4",
        422,
      ),
      operationId: "updateCodexExecutionConcurrency",
      security: [
        {
          browser_session: [],
        },
      ],
      response: {
        200: {
          $ref: "CodexExecutionConcurrency#",
          description: "Installation-wide Codex execution concurrency",
        },
        ...errorResponses(400, 401, 403, 422, 503),
      },
      body: {
        $ref: "CodexExecutionConcurrency#",
      },
    },
    url: "/api/v1/system/codex-concurrency",
  },
  {
    method: "GET",
    schema: {
      operationId: "listAuthorityAttributions",
      security: [
        {
          browser_session: [],
        },
      ],
      response: {
        200: {
          $ref: "AuthorityAttributionCollection#",
          description: "Attribution collection",
        },
        ...errorResponses(400, 401, 403, 503),
      },
      querystring: {
        additionalProperties: false,
        properties: {
          cursor: {
            type: "string",
          },
          limit: {
            maximum: 100,
            minimum: 1,
            type: "integer",
          },
        },
        required: [],
        type: "object",
      },
    },
    url: "/api/v1/system/authority-attributions",
  },
];
