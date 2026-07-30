import assert from "node:assert/strict";
import test from "node:test";

import {
  executeWaiverTool,
  submitWaiverArguments,
  waiverAdjudicationArguments,
} from "../src/mcp-waiver.js";

test("MCP waiver inputs accept only the two fixed closed tool shapes", () => {
  assert.deepEqual(
    submitWaiverArguments({
      evaluation_id: "evaluation-1",
      idempotency_key: "waiver-key",
      requests: [{ finding_id: "finding-1", rationale: "Exact rationale." }],
    }),
    {
      evaluationId: "evaluation-1",
      idempotencyKey: "waiver-key",
      request: {
        requests: [{ finding_id: "finding-1", rationale: "Exact rationale." }],
      },
    },
  );
  assert.deepEqual(
    waiverAdjudicationArguments({
      waiver_adjudication_id: "adjudication-1",
    }),
    { adjudicationId: "adjudication-1" },
  );
  for (const invalid of [
    {},
    {
      evaluation_id: "evaluation-1",
      idempotency_key: "waiver-key",
      requests: [],
      unexpected: true,
    },
    { waiver_adjudication_id: "" },
  ]) {
    assert.throws(
      () =>
        "evaluation_id" in invalid
          ? submitWaiverArguments(invalid)
          : waiverAdjudicationArguments(invalid),
      { code: "request_malformed" },
    );
  }
});

test("MCP waiver submission delegates to the atomic service and links accepted facts", () => {
  let submitted;
  const result = executeWaiverTool(
    "quality_bar.submit_waiver_requests",
    {
      evaluation_id: "evaluation-1",
      idempotency_key: "waiver-key",
      requests: [{ finding_id: "finding-1", rationale: "Exact rationale." }],
    },
    /** @type {any} */ ({
      /** @param {any} input */
      submitWaiverBatch(input) {
        submitted = input;
        return {
          resource: {
            adjudication: { id: "adjudication-1" },
            requests: [{ id: "request-1" }],
          },
          status: 201,
        };
      },
    }),
  );
  assert.deepEqual(submitted, {
    channel: "mcp",
    evaluationId: "evaluation-1",
    idempotencyKey: "waiver-key",
    request: {
      requests: [{ finding_id: "finding-1", rationale: "Exact rationale." }],
    },
  });
  assert.deepEqual(
    result.links.map(({ uri }) => uri),
    [
      "quality-bar://v1/waiver-adjudications/adjudication-1",
      "quality-bar://v1/waiver-requests/request-1",
    ],
  );
});

test("MCP waiver polling preserves terminal errors without Decisions", () => {
  for (const document of [
    {
      error: { code: "codex_process_failed", detail: "Exact failure." },
      execution_status: "failed",
      id: "adjudication-failed",
      request_ids: ["request-1"],
    },
    {
      error: {
        code: "waiver_adjudication_cancelled",
        detail: "Waiver Adjudication was cancelled",
      },
      execution_status: "cancelled",
      id: "adjudication-cancelled",
      request_ids: ["request-1"],
    },
  ]) {
    const result = executeWaiverTool(
      "quality_bar.get_waiver_adjudication",
      { waiver_adjudication_id: document.id },
      /** @type {any} */ ({
        readWaiverAdjudication() {
          return document;
        },
      }),
    );
    assert.deepEqual(result.document, document);
    assert.equal("decisions" in result.document, false);
  }
});
