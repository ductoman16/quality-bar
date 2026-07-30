/** @param {object} errorResponse */
export function canonicalAnalyticsPath(errorResponse) {
  /** @param {string} name */
  const stringFilter = (name) => ({
    in: "query",
    name,
    schema: { minLength: 1, type: "string" },
  });
  return {
    "/api/v1/analytics": {
      get: {
        operationId: "getAnalytics",
        parameters: [
          ...[
            "repository_id",
            "review_id",
            "review_version_id",
            "criterion_id",
            "model",
            "reasoning_effort",
            "service_tier",
          ].map(stringFilter),
          {
            in: "query",
            name: "base_commit",
            schema: {
              pattern: "^([0-9a-f]{40}|[0-9a-f]{64})$",
              type: "string",
            },
          },
          {
            in: "query",
            name: "head_commit",
            schema: {
              pattern: "^([0-9a-f]{40}|[0-9a-f]{64})$",
              type: "string",
            },
          },
          {
            in: "query",
            name: "pull_request_number",
            schema: { minimum: 1, type: "integer" },
          },
          {
            in: "query",
            name: "terminal_outcome",
            schema: {
              enum: ["clear", "advisory", "blocking", "error"],
              type: "string",
            },
          },
          {
            in: "query",
            name: "start",
            schema: { minimum: 0, type: "integer" },
          },
          {
            in: "query",
            name: "end",
            schema: { minimum: 0, type: "integer" },
          },
        ],
        responses: {
          200: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Analytics" },
              },
            },
            description: "Canonical Analytics facts",
          },
          400: errorResponse,
          401: errorResponse,
          500: errorResponse,
          503: errorResponse,
        },
        security: [{ browser_session: [] }, { implementer_token: [] }],
      },
    },
  };
}
