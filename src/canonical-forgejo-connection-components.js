export const forgejoRepositoryCheck = {
  oneOf: [
    {
      additionalProperties: false,
      properties: {
        api_url: { format: "uri", type: "string" },
        clone_url: { format: "uri", type: "string" },
        full_name: { minLength: 1, type: "string" },
        html_url: { format: "uri", type: "string" },
        id: { minimum: 1, type: "integer" },
        outcome: { const: "success", type: "string" },
        private: { type: "boolean" },
      },
      required: [
        "api_url",
        "clone_url",
        "full_name",
        "html_url",
        "id",
        "outcome",
        "private",
      ],
      type: "object",
    },
    {
      additionalProperties: false,
      properties: {
        forge_repository_id: { minimum: 1, type: "integer" },
        outcome: { const: "not_completed", type: "string" },
      },
      required: ["forge_repository_id", "outcome"],
      type: "object",
    },
    {
      additionalProperties: false,
      properties: {
        error: {
          additionalProperties: false,
          properties: {
            code: { minLength: 1, type: "string" },
            message: { minLength: 1, type: "string" },
          },
          required: ["code", "message"],
          type: "object",
        },
        forge_repository_id: { minimum: 1, type: "integer" },
        outcome: { const: "error", type: "string" },
      },
      required: ["error", "forge_repository_id", "outcome"],
      type: "object",
    },
  ],
};
