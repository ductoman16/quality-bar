import assert from "node:assert/strict";
import test from "node:test";

import { classifyWaiverAdjudicationRecovery } from "../src/waiver/waiver-adjudication-recovery.ts";
import { isTransientWaiverPreStartFailure } from "../src/waiver/waiver-adjudication-pre-start.ts";

test("only temporary checkout preparation uses the timed pre-start budget", () => {
  assert.equal(
    isTransientWaiverPreStartFailure(
      Object.assign(new Error("Checkout preparation failed"), {
        code: "review_run_checkout_failed",
      }),
    ),
    true,
  );
  assert.equal(
    isTransientWaiverPreStartFailure(
      Object.assign(new Error("Repository permission is denied"), {
        code: "repository_permission_denied",
      }),
    ),
    false,
  );
});

test("waiver recovery keeps only pre-start exhaustion on the accepted identity", () => {
  assert.equal(
    classifyWaiverAdjudicationRecovery({
      execution_status: "queued",
      retry_state: "exhausted",
      started_at: null,
    }),
    "same_identity",
  );
  assert.equal(
    classifyWaiverAdjudicationRecovery({
      execution_status: "failed",
      retry_state: "ready",
      started_at: 12,
    }),
    "new_adjudication",
  );
  assert.equal(
    classifyWaiverAdjudicationRecovery({
      execution_status: "cancelled",
      retry_state: "ready",
      started_at: 12,
    }),
    "new_adjudication",
  );
});

test("waiver recovery rejects active, unsupported, and Decision-owned states exactly", () => {
  for (const [adjudication, code] of [
    [
      {
        execution_status: "queued",
        retry_state: "ready",
        started_at: null,
      },
      "waiver_adjudication_recovery_not_exhausted",
    ],
    [
      {
        execution_status: "running",
        retry_state: "ready",
        started_at: 12,
      },
      "waiver_adjudication_active",
    ],
    [
      {
        execution_status: "completed",
        retry_state: "ready",
        started_at: 12,
      },
      "waiver_adjudication_decision_retry_required",
    ],
    [
      {
        execution_status: "failed",
        retry_state: "ready",
        started_at: null,
      },
      "waiver_adjudication_recovery_invalid",
    ],
  ]) {
    assert.throws(
      () => classifyWaiverAdjudicationRecovery(adjudication),
      (error) =>
        error instanceof Error && "code" in error && error.code === code,
    );
  }
});
