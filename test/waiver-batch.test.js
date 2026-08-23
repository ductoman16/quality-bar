import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalWaiverErrorRetryRequest,
  canonicalWaiverBatchRequest,
  createWaiverBatchService,
} from "../src/waiver/waiver-batch.js";

test("canonical waiver batch requires unique Findings and scenario-specific rationales", () => {
  assert.deepEqual(
    canonicalWaiverBatchRequest({
      requests: [
        { finding_id: "finding-2", rationale: "  Deployment cannot use it. " },
        {
          finding_id: "finding-1",
          rationale: "The generated file is retained.",
        },
      ],
    }),
    {
      requests: [
        {
          finding_id: "finding-1",
          rationale: "The generated file is retained.",
        },
        { finding_id: "finding-2", rationale: "Deployment cannot use it." },
      ],
    },
  );
  for (const candidate of [
    {},
    { requests: [] },
    { requests: [{ finding_id: "finding-1", rationale: " " }] },
    {
      requests: [
        { finding_id: "finding-1", rationale: "One reason" },
        { finding_id: "finding-1", rationale: "Another reason" },
      ],
    },
  ]) {
    assert.throws(
      () => canonicalWaiverBatchRequest(candidate),
      (error) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "waiver_batch_invalid",
    );
  }
});

test("canonical waiver error retry requires unique immutable Request identities", () => {
  assert.deepEqual(
    canonicalWaiverErrorRetryRequest({
      request_ids: ["request-2", "request-1"],
    }),
    { request_ids: ["request-1", "request-2"] },
  );
  for (const candidate of [
    {},
    { request_ids: [] },
    { request_ids: [""] },
    { request_ids: ["request-1", "request-1"] },
    { request_ids: ["request-1"], unexpected: true },
  ]) {
    assert.throws(
      () => canonicalWaiverErrorRetryRequest(candidate),
      (error) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "waiver_error_retry_invalid",
    );
  }
});

test("waiver rejection consumes no idempotency key", () => {
  const rows = [];
  const service = createWaiverBatchService(
    {
      all() {
        return [];
      },
      get() {
        return undefined;
      },
      transaction(/** @type {(transaction: any) => unknown} */ callback) {
        return callback({
          all() {
            return [];
          },
          get(/** @type {string} */ sql) {
            return sql.includes("FROM evaluations")
              ? {
                  base_commit: "a".repeat(40),
                  evaluation_id: "evaluation-1",
                  execution_status: "completed",
                  head_commit: "b".repeat(40),
                }
              : sql.includes("waiver_adjudicator_configuration")
                ? {
                    model: "gpt-5.6-terra",
                    reasoning_effort: "high",
                    service_tier: "standard",
                  }
                : undefined;
          },
          run(/** @type {string} */ sql) {
            rows.push(sql);
            return { changes: 1 };
          },
        });
      },
    },
    {
      createAdjudicationId: () => "adjudication-1",
      createRequestId: () => "request-1",
      now: () => 1_753_800_000_000,
      readCodexCapabilityFailure: () => null,
      storageReserve: { assertWorkAdmissionAvailable() {} },
    },
  );

  assert.throws(
    () =>
      service.submit({
        channel: "implementer_token",
        evaluationId: "evaluation-1",
        idempotencyKey: "retry-key",
        request: {
          requests: [{ finding_id: "missing", rationale: "Specific reason" }],
        },
      }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "finding_not_found",
  );
  assert.equal(rows.length, 0);
});
