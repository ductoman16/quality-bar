/** @param {Record<string, unknown>} properties @param {string[]} required */
const closedObject = (properties, required) => ({
  additionalProperties: false,
  properties,
  required,
  type: "object",
});

export const forgejoPollingError = closedObject(
  {
    code: { minLength: 1, type: "string" },
    message: { minLength: 1, type: "string" },
  },
  ["code", "message"],
);

export const forgejoPollingFailure = closedObject(
  {
    error: forgejoPollingError,
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
);

const pollingStateProperties = {
  error: { oneOf: [forgejoPollingError, { type: "null" }] },
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
};
const pollingStateRequired = [
  "baseline_status",
  "error",
  "forge_repository_id",
  "last_success_at",
  "next_attempt_at",
  "rate_gate_until",
];

/** @param {"pending" | "complete" | "error"} status @param {Record<string, unknown>} properties */
const pollingState = (status, properties) =>
  closedObject(
    {
      ...pollingStateProperties,
      ...properties,
      baseline_status: { const: status, type: "string" },
    },
    pollingStateRequired,
  );

export const forgejoPollingState = {
  oneOf: [
    pollingState("pending", {
      error: { type: "null" },
      next_attempt_at: { minimum: 0, type: "integer" },
    }),
    pollingState("complete", {
      last_success_at: { minimum: 0, type: "integer" },
    }),
    pollingState("error", { error: forgejoPollingError }),
  ],
};
