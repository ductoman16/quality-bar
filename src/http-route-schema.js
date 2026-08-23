import { withValidationError } from "./canonical/canonical-schema.js";

const errorResponse = { $ref: "ErrorResponse#" };

/** @param {string} code @param {string} message @param {number} status */
export function canonicalValidationError(code, message, status) {
  return { "x-quality-bar-error": { code, message, status } };
}

/** @param {number[]} statuses */
export function errorResponses(...statuses) {
  return Object.fromEntries(statuses.map((status) => [status, errorResponse]));
}

/** @param {Record<string, unknown>} [properties] @param {string[]} [required] */
export function browserMutationHeaders(properties = {}, required = []) {
  return {
    additionalProperties: true,
    properties: {
      origin: { format: "uri", type: "string" },
      "x-quality-bar-csrf": { type: "string" },
      ...properties,
    },
    required: ["origin", "x-quality-bar-csrf", ...required],
    type: "object",
  };
}

/** @param {Record<string, unknown>} properties @param {string[]} required */
export function authenticatedMutationHeaders(properties, required) {
  return {
    additionalProperties: true,
    anyOf: [
      { required: ["authorization"] },
      { required: ["origin", "x-quality-bar-csrf"] },
    ],
    properties: {
      origin: { format: "uri", type: "string" },
      "x-quality-bar-csrf": { type: "string" },
      ...properties,
    },
    required,
    type: "object",
  };
}

export const idempotencyKeyHeader = withValidationError(
  {
    maxLength: 255,
    minLength: 1,
    pattern: "^[\\x21-\\x7e]+$",
    type: "string",
  },
  "idempotency_key_required",
  "A valid Idempotency-Key header is required",
  400,
);
