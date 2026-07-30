import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyCodexExecutionRecovery,
  terminateTrackedCodexProcessGroup,
} from "../src/codex-execution-recovery.js";

test("queued Codex work survives restart without becoming a started attempt", () => {
  assert.equal(
    classifyCodexExecutionRecovery({
      execution_status: "queued",
      started_at: null,
      work_kind: "review_run",
    }),
    "queued",
  );
  assert.equal(
    classifyCodexExecutionRecovery({
      execution_status: "queued",
      started_at: null,
      work_kind: "waiver_adjudication",
    }),
    "queued",
  );
});

test("accepted submission and durable cancellation remain terminal on restart", () => {
  for (const executionStatus of ["completed", "failed", "cancelled"]) {
    assert.equal(
      classifyCodexExecutionRecovery({
        execution_status: executionStatus,
        started_at: 20,
        work_kind: "review_run",
      }),
      "terminal",
    );
  }
});

test("a started running execution is interrupted rather than retried", () => {
  assert.equal(
    classifyCodexExecutionRecovery({
      execution_status: "running",
      started_at: 20,
      work_kind: "waiver_adjudication",
    }),
    "interrupted",
  );
});

test("unsupported durable recovery facts fail with their owning error", () => {
  assert.throws(
    () =>
      classifyCodexExecutionRecovery({
        execution_status: "queued",
        started_at: 20,
        work_kind: "review_run",
      }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "codex_execution_recovery_state_invalid" &&
      error.message === "Codex execution recovery state is invalid",
  );
});

test("a tracked survivor receives process-group termination without reattachment", () => {
  /** @type {[number, NodeJS.Signals | 0][]} */
  const signals = [];
  const result = terminateTrackedCodexProcessGroup(
    4321,
    (processId, signal) => {
      signals.push([processId, signal]);
    },
  );

  assert.equal(result, "SIGKILL");
  assert.deepEqual(signals, [
    [-4321, 0],
    [-4321, "SIGTERM"],
    [-4321, "SIGKILL"],
  ]);
});

test("an already absent tracked process group remains an exact no-survivor fact", () => {
  const result = terminateTrackedCodexProcessGroup(4321, () => {
    throw Object.assign(new Error("missing"), { code: "ESRCH" });
  });
  assert.equal(result, null);
});
