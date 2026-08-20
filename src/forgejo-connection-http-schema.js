import {
  forgejoFailedVerification,
  forgejoSuccessfulVerification,
} from "./canonical-forgejo-connection-components.js";
import {
  forgejoPollingFailure,
  forgejoPollingState,
} from "./canonical-forgejo-polling-components.js";

export const forgejoConnectionSchema = {
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
    polling_failure: { oneOf: [forgejoPollingFailure, { type: "null" }] },
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
  allOf: [
    {
      if: { properties: { health: { const: "healthy" } } },
      then: {
        properties: { health_error: { type: "null" } },
      },
    },
    {
      if: { properties: { health: { const: "error" } } },
      then: {
        properties: {
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
      },
    },
  ],
};
