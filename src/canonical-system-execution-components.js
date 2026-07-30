import { closedObject } from "./canonical-schema.js";

const failureDetail = {
  $ref: "#/components/schemas/CodexExecutionSystemFailureDetail",
};
const retryError = { anyOf: [failureDetail, { type: "null" }] };
const gate = { $ref: "#/components/schemas/CodexExecutionSystemGate" };
const lease = { $ref: "#/components/schemas/CodexExecutionSystemLease" };

/** @param {"queued" | "running"} executionStatus @param {Record<string, unknown>} resource */
function executionRow(executionStatus, resource) {
  const queued = executionStatus === "queued";
  return closedObject(
    {
      ...resource,
      execution_status: { const: executionStatus, type: "string" },
      gate,
      lease,
      ...(queued
        ? {
            next_attempt_at: {
              format: "date-time",
              type: ["string", "null"],
            },
            queue_position: { minimum: 1, type: "integer" },
          }
        : {}),
      pre_start_attempt_count: { minimum: 0, type: "integer" },
      retry_cycle: { minimum: 1, type: "integer" },
      retry_error: retryError,
      retry_state: { enum: ["ready", "exhausted"], type: "string" },
    },
    [
      ...Object.keys(resource),
      "execution_status",
      ...(queued ? ["queue_position"] : []),
      "pre_start_attempt_count",
      "retry_cycle",
      "retry_state",
      "retry_error",
      ...(queued ? ["next_attempt_at"] : []),
      "lease",
      "gate",
    ],
  );
}

/** @param {"queued" | "running"} executionStatus */
function resourceRows(executionStatus) {
  return {
    oneOf: [
      executionRow(executionStatus, {
        evaluation_id: { type: "string" },
        review_run_id: { type: "string" },
      }),
      executionRow(executionStatus, {
        waiver_adjudication_id: { type: "string" },
      }),
    ],
  };
}

export function canonicalSystemExecutionSchemas() {
  return {
    CodexExecutionSystemFact: closedObject(
      {
        concurrency: {
          $ref: "#/components/schemas/CodexExecutionSystemConcurrency",
        },
        failures: {
          items: {
            $ref: "#/components/schemas/CodexExecutionSystemFailure",
          },
          type: "array",
        },
        queue: { $ref: "#/components/schemas/CodexExecutionSystemQueue" },
        running: { $ref: "#/components/schemas/CodexExecutionSystemRunning" },
      },
      ["concurrency", "queue", "running", "failures"],
    ),
    CodexExecutionSystemConcurrency: closedObject(
      {
        maximum_running: { maximum: 4, minimum: 1, type: "integer" },
        running_count: { minimum: 0, type: "integer" },
        start_gate: { enum: ["available", "no_new_start"], type: "string" },
      },
      ["maximum_running", "running_count", "start_gate"],
    ),
    CodexExecutionSystemQueue: closedObject(
      {
        count: { minimum: 0, type: "integer" },
        rows: {
          items: {
            $ref: "#/components/schemas/CodexExecutionSystemQueuedRow",
          },
          type: "array",
        },
      },
      ["count", "rows"],
    ),
    CodexExecutionSystemRunning: closedObject(
      {
        count: { minimum: 0, type: "integer" },
        rows: {
          items: {
            $ref: "#/components/schemas/CodexExecutionSystemRunningRow",
          },
          type: "array",
        },
      },
      ["count", "rows"],
    ),
    CodexExecutionSystemFailureDetail: closedObject(
      { code: { type: "string" }, detail: { type: "string" } },
      ["code", "detail"],
    ),
    CodexExecutionSystemGate: closedObject({ code: { type: "string" } }, [
      "code",
    ]),
    CodexExecutionSystemLease: closedObject(
      {
        expires_at: { format: "date-time", type: ["string", "null"] },
        fencing_token: { minimum: 0, type: "integer" },
        status: {
          enum: ["unclaimed", "held", "released", "stuck", "running"],
          type: "string",
        },
        worker_id: { type: ["string", "null"] },
      },
      ["expires_at", "fencing_token", "status", "worker_id"],
    ),
    CodexExecutionSystemQueuedRow: resourceRows("queued"),
    CodexExecutionSystemRunningRow: resourceRows("running"),
    CodexExecutionSystemFailure: {
      oneOf: [
        closedObject(
          {
            completed_at: { format: "date-time", type: "string" },
            error: failureDetail,
            evaluation_id: { type: "string" },
            review_run_id: { type: "string" },
          },
          ["evaluation_id", "review_run_id", "completed_at", "error"],
        ),
        closedObject(
          {
            completed_at: { format: "date-time", type: "string" },
            error: failureDetail,
            waiver_adjudication_id: { type: "string" },
          },
          ["waiver_adjudication_id", "completed_at", "error"],
        ),
      ],
    },
  };
}
