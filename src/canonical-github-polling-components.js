/** @param {Record<string, unknown>} properties @param {string[]} required */
const closedObject = (properties, required) => ({
  additionalProperties: false,
  properties,
  required,
  type: "object",
});

export function canonicalGitHubPollingSchemas() {
  return {
    GitHubPollingError: closedObject(
      {
        code: { minLength: 1, type: "string" },
        message: { minLength: 1, type: "string" },
      },
      ["code", "message"],
    ),
    GitHubPollingFailure: closedObject(
      {
        error: { $ref: "#/components/schemas/GitHubPollingError" },
        forge_repository_id: {
          oneOf: [{ minimum: 1, type: "integer" }, { type: "null" }],
        },
        next_attempt_at: {
          oneOf: [{ minimum: 0, type: "integer" }, { type: "null" }],
        },
        rate_gate_until: {
          oneOf: [{ minimum: 0, type: "integer" }, { type: "null" }],
        },
      },
      ["error", "forge_repository_id", "next_attempt_at", "rate_gate_until"],
    ),
    GitHubPollingState: {
      ...closedObject(
        {
          baseline_status: {
            enum: ["complete", "error", "pending"],
            type: "string",
          },
          error: {
            oneOf: [
              { $ref: "#/components/schemas/GitHubPollingError" },
              { type: "null" },
            ],
          },
          forge_repository_id: { minimum: 1, type: "integer" },
          last_success_at: {
            oneOf: [{ minimum: 0, type: "integer" }, { type: "null" }],
          },
          next_attempt_at: {
            oneOf: [{ minimum: 0, type: "integer" }, { type: "null" }],
          },
          rate_gate_until: {
            oneOf: [{ minimum: 0, type: "integer" }, { type: "null" }],
          },
        },
        [
          "baseline_status",
          "error",
          "forge_repository_id",
          "last_success_at",
          "next_attempt_at",
          "rate_gate_until",
        ],
      ),
      oneOf: [
        {
          properties: {
            baseline_status: { const: "pending" },
            error: { type: "null" },
            last_success_at: { type: "null" },
            next_attempt_at: { minimum: 0, type: "integer" },
          },
          required: [
            "baseline_status",
            "error",
            "last_success_at",
            "next_attempt_at",
          ],
        },
        {
          properties: {
            baseline_status: { const: "complete" },
            last_success_at: { minimum: 0, type: "integer" },
          },
          required: ["baseline_status", "last_success_at"],
        },
        {
          properties: {
            baseline_status: { const: "error" },
            error: { $ref: "#/components/schemas/GitHubPollingError" },
          },
          required: ["baseline_status", "error"],
        },
      ],
    },
  };
}
