import { withValidationError } from "./canonical/schema.ts";

const errorResponse = { $ref: "ErrorResponse#" };

export function canonicalValidationError(
  code: string,
  message: string,
  status: number,
) {
  return { "x-quality-bar-error": { code, message, status } };
}

export function errorResponses(...statuses: number[]) {
  return Object.fromEntries(statuses.map((status) => [status, errorResponse]));
}

export function browserMutationHeaders(
  properties: Record<string, unknown> = {},
  required: string[] = [],
) {
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

export function authenticatedMutationHeaders(
  properties: Record<string, unknown>,
  required: string[],
) {
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
