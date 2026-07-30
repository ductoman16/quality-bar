import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { executeServedBrowserAsset } from "../scripts/application-coverage-policy.mjs";
import { readBrowserAsset } from "../src/browser-assets.js";

test("the browser preserves queued state and the exact owning execution failure", () => {
  const context = /** @type {any} */ ({ window: {} });
  executeServedBrowserAsset(
    resolve("."),
    "src/browser/waiver-batch.js",
    readBrowserAsset("/assets/waiver-batch.js"),
    context,
  );
  const describeStatus = context.window.qualityBarWaiverBatch.describeStatus;
  assert.equal(
    describeStatus({
      execution_status: "queued",
      id: "adjudication-queued",
    }),
    "Waiver Adjudication adjudication-queued queued.",
  );
  assert.equal(
    describeStatus({
      error: {
        code: "result_not_submitted",
        detail: "Codex exited without an accepted Decision set",
      },
      execution_status: "failed",
      id: "adjudication-failed",
    }),
    "Waiver Adjudication adjudication-failed failed. Error result_not_submitted: Codex exited without an accepted Decision set",
  );
  assert.equal(
    describeStatus({
      decisions: [
        {
          explanation:
            "The inspected evidence proves this exact exception is justified.",
          id: "decision-accepted",
          outcome: "accepted",
          request_id: "request-accepted",
        },
        {
          explanation:
            "The rationale is uncertain and does not justify an exception.",
          id: "decision-denied",
          outcome: "denied",
          request_id: "request-denied",
        },
        {
          error: {
            code: "required_evidence_unavailable",
            detail: "The frozen generated file cannot be inspected.",
          },
          id: "decision-error",
          outcome: "error",
          request_id: "request-error",
        },
      ],
      execution_status: "completed",
      id: "adjudication-completed",
    }),
    "Waiver Adjudication adjudication-completed completed. Decisions: request-accepted accepted: The inspected evidence proves this exact exception is justified. request-denied denied: The rationale is uncertain and does not justify an exception. request-error error required_evidence_unavailable: The frozen generated file cannot be inspected.",
  );
  for (const invalidDecision of [
    {
      error: { code: " ", detail: "Exact detail." },
      id: "decision-error",
      outcome: "error",
      request_id: "request-error",
    },
    {
      error: { code: "required_evidence_unavailable", detail: " " },
      id: "decision-error",
      outcome: "error",
      request_id: "request-error",
    },
    {
      explanation: "Accepted.",
      id: " ",
      outcome: "accepted",
      request_id: "request-accepted",
    },
  ]) {
    assert.throws(
      () =>
        describeStatus({
          decisions: [invalidDecision],
          execution_status: "completed",
          id: "adjudication-invalid",
        }),
      /waiver_adjudication_invalid/,
    );
  }
});
