import { errorResponses } from "../http-route-schema.js";

export const analyticsSchemas = {};

export const analyticsRoutes = [
  {
    method: "GET",
    schema: {
      operationId: "getAnalytics",
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
          $ref: "Analytics#",
          description: "Canonical Analytics facts",
        },
        ...errorResponses(400, 401, 500, 503),
      },
      querystring: {
        additionalProperties: false,
        properties: {
          repository_id: {
            minLength: 1,
            type: "string",
          },
          review_id: {
            minLength: 1,
            type: "string",
          },
          review_version_id: {
            minLength: 1,
            type: "string",
          },
          criterion_id: {
            minLength: 1,
            type: "string",
          },
          model: {
            minLength: 1,
            type: "string",
          },
          reasoning_effort: {
            minLength: 1,
            type: "string",
          },
          service_tier: {
            minLength: 1,
            type: "string",
          },
          base_commit: {
            pattern: "^([0-9a-f]{40}|[0-9a-f]{64})$",
            type: "string",
          },
          head_commit: {
            pattern: "^([0-9a-f]{40}|[0-9a-f]{64})$",
            type: "string",
          },
          pull_request_number: {
            minimum: 1,
            type: "integer",
          },
          terminal_outcome: {
            enum: ["clear", "advisory", "blocking", "error"],
            type: "string",
          },
          start: {
            minimum: 0,
            type: "integer",
          },
          end: {
            minimum: 0,
            type: "integer",
          },
        },
        required: [],
        type: "object",
      },
    },
    url: "/api/v1/analytics",
  },
];
