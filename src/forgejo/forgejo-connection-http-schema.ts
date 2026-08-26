import {
  forgejoFailedVerification,
  forgejoPollingFailure,
  forgejoPollingState,
  forgejoSuccessfulVerification,
} from "../canonical/forge.ts";

const connectionHealthError = {
  additionalProperties: false,
  properties: {
    code: { minLength: 1, type: "string" },
    message: { minLength: 1, type: "string" },
  },
  required: ["code", "message"],
  type: "object",
};

function connectionSchema(health: "healthy" | "error") {
  return {
    additionalProperties: false,
    properties: {
      api_profile: { const: "forgejo", type: "string" },
      base_url: { format: "uri", type: "string" },
      capabilities: { additionalProperties: true, type: "object" },
      health: { const: health, type: "string" },
      health_error:
        health === "healthy" ? { type: "null" } : connectionHealthError,
      id: { type: "string" },
      lifecycle: { enum: ["enabled", "retired"], type: "string" },
      principal: {
        additionalProperties: true,
        description:
          "Repository-owner identity observed through the Repository-restricted PAT",
        type: "object",
      },
      polling: { items: forgejoPollingState, type: "array" },
      polling_failure: { oneOf: [forgejoPollingFailure, { type: "null" }] },
      reported_version: { pattern: "^16\\.", type: "string" },
      scopes: {
        description:
          "Required Forgejo PAT authorities proven through route and capability behavior",
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
  };
}

export const forgejoConnectionSchema = {
  oneOf: [connectionSchema("healthy"), connectionSchema("error")],
};
