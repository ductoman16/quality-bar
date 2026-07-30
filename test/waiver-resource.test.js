import assert from "node:assert/strict";
import test from "node:test";

import {
  readWaiverAdjudication,
  readWaiverDecision,
  readWaiverRequest,
} from "../src/waiver-resource.js";

test("active Waiver Adjudications expose no speculative Decisions", () => {
  assert.deepEqual(
    readWaiverAdjudication(
      {
        all() {
          assert.fail("active Adjudication read Decisions");
        },
      },
      {
        base_commit: "a".repeat(40),
        completed_at: null,
        created_at: 1,
        error_code: null,
        error_detail: null,
        evaluation_id: "evaluation-1",
        execution_status: "running",
        head_commit: "b".repeat(40),
        id: "adjudication-1",
        model: "gpt-5.6-terra",
        reasoning_effort: "high",
        service_tier: "standard",
        started_at: 2,
      },
      ["request-1"],
    ),
    {
      base_commit: "a".repeat(40),
      completed_at: null,
      configuration: {
        model: "gpt-5.6-terra",
        reasoning_effort: "high",
        service_tier: "standard",
      },
      created_at: "1970-01-01T00:00:00.001Z",
      evaluation_id: "evaluation-1",
      execution_status: "running",
      head_commit: "b".repeat(40),
      id: "adjudication-1",
      request_ids: ["request-1"],
      started_at: "1970-01-01T00:00:00.002Z",
    },
  );
});

test("failed Waiver Adjudications expose the exact failure and no Decisions", () => {
  const adjudication = readWaiverAdjudication(
    {
      all() {
        assert.fail("failed Adjudication read Decisions");
      },
    },
    {
      base_commit: "a".repeat(40),
      completed_at: 3,
      created_at: 1,
      error_code: "codex_process_failed",
      error_detail: "Codex exited before submitting Decisions",
      evaluation_id: "evaluation-1",
      execution_status: "failed",
      head_commit: "b".repeat(40),
      id: "adjudication-1",
      model: "gpt-5.6-terra",
      reasoning_effort: "high",
      service_tier: "standard",
      started_at: 2,
    },
    ["request-1"],
  );
  assert.deepEqual(adjudication.error, {
    code: "codex_process_failed",
    detail: "Codex exited before submitting Decisions",
  });
  assert.equal("decisions" in adjudication, false);
});

test("canonical waiver Request and Decision resources preserve immutable facts", () => {
  assert.deepEqual(
    readWaiverRequest({
      created_at: 1,
      evaluation_id: "evaluation-1",
      finding_id: "finding-1",
      id: "request-1",
      rationale: "Exact exception.",
    }),
    {
      created_at: "1970-01-01T00:00:00.001Z",
      evaluation_id: "evaluation-1",
      finding_id: "finding-1",
      id: "request-1",
      rationale: "Exact exception.",
    },
  );
  assert.deepEqual(
    readWaiverDecision({
      created_at: 3,
      error_code: null,
      error_detail: null,
      explanation: "The exact evidence justifies the exception.",
      id: "decision-1",
      outcome: "accepted",
      waiver_adjudication_id: "adjudication-1",
      waiver_request_id: "request-1",
    }),
    {
      created_at: "1970-01-01T00:00:00.003Z",
      explanation: "The exact evidence justifies the exception.",
      id: "decision-1",
      outcome: "accepted",
      request_id: "request-1",
      waiver_adjudication_id: "adjudication-1",
    },
  );
});
