import { closedObject } from "./canonical-schema.js";

const errorResponse = {
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/ErrorResponse" },
    },
  },
  description: "A secret-safe canonical error",
};

const response = {
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/CodexExecutionConcurrency" },
    },
  },
  description: "Installation-wide Codex execution concurrency",
};

export function canonicalCodexExecutionConcurrencyPath() {
  return {
    "/api/v1/system/codex-concurrency": {
      get: {
        operationId: "getCodexExecutionConcurrency",
        responses: {
          200: response,
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          422: errorResponse,
          503: errorResponse,
        },
        security: [{ browser_session: [] }],
      },
      patch: {
        operationId: "updateCodexExecutionConcurrency",
        parameters: [
          {
            in: "header",
            name: "Origin",
            required: true,
            schema: { format: "uri", type: "string" },
          },
          {
            in: "header",
            name: "x-quality-bar-csrf",
            required: true,
            schema: { type: "string" },
          },
        ],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/CodexExecutionConcurrency",
              },
            },
          },
          required: true,
        },
        responses: {
          200: response,
          400: errorResponse,
          401: errorResponse,
          403: errorResponse,
          422: errorResponse,
          503: errorResponse,
        },
        security: [{ browser_session: [] }],
      },
    },
  };
}

export function canonicalCodexExecutionConcurrencySchemas() {
  return {
    CodexExecutionConcurrency: closedObject(
      {
        maximum_running: { maximum: 4, minimum: 1, type: "integer" },
      },
      ["maximum_running"],
    ),
  };
}
