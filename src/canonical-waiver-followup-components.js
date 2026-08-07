import { closedObject } from "./canonical-schema.js";

export function canonicalWaiverFollowupSchemas() {
  const identifier = { minLength: 1, type: "string" };
  const nullValue = { type: "null" };
  const nullableTimestamp = {
    oneOf: [{ format: "date-time", type: "string" }, nullValue],
  };
  const nullableError = {
    oneOf: [{ $ref: "#/components/schemas/WaiverOperationalError" }, nullValue],
  };
  return {
    WaiverFollowupAttempt: closedObject(
      {
        attempt_count: { minimum: 0, type: "integer" },
        error: nullableError,
        last_attempt_at: nullableTimestamp,
        next_attempt_at: nullableTimestamp,
        reconciliation_required: { type: "boolean" },
      },
      [
        "attempt_count",
        "error",
        "last_attempt_at",
        "next_attempt_at",
        "reconciliation_required",
      ],
    ),
    WaiverFollowupSurface: closedObject(
      {
        error: nullableError,
        latest_attempt: {
          oneOf: [
            { $ref: "#/components/schemas/WaiverFollowupAttempt" },
            nullValue,
          ],
        },
        publication_status: {
          enum: ["waiting", "succeeded", "unavailable"],
          type: "string",
        },
      },
      ["publication_status", "error", "latest_attempt"],
    ),
    WaiverLocalFollowupSurface: closedObject(
      {
        decision_id: identifier,
        error: nullableError,
        latest_attempt: {
          oneOf: [
            { $ref: "#/components/schemas/WaiverFollowupAttempt" },
            nullValue,
          ],
        },
        publication_status: {
          enum: ["waiting", "succeeded", "unavailable"],
          type: "string",
        },
      },
      ["decision_id", "publication_status", "error", "latest_attempt"],
    ),
    WaiverFollowupPublication: closedObject(
      {
        aggregate: { $ref: "#/components/schemas/WaiverFollowupSurface" },
        local: {
          items: { $ref: "#/components/schemas/WaiverLocalFollowupSurface" },
          type: "array",
        },
      },
      ["aggregate", "local"],
    ),
  };
}
