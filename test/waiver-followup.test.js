import assert from "node:assert/strict";
import test from "node:test";

import {
  formatWaiverAdjudicationFollowup,
  formatWaiverDecisionFollowup,
} from "../src/waiver-followup.js";

const identity = {
  adjudication_id: "adjudication-1",
  base_commit: "a".repeat(40),
  details_url:
    "https://quality-bar.example/?view=evaluations&evaluation_id=evaluation-1",
  evaluation_id: "evaluation-1",
  head_commit: "b".repeat(40),
  outcome: "advisory",
};

test("aggregate waiver follow-up reports every completed Decision", () => {
  const body = formatWaiverAdjudicationFollowup(identity, [
    {
      error_code: null,
      error_detail: null,
      explanation: "The exception is justified.",
      finding_id: "finding-accepted",
      outcome: "accepted",
      request_id: "request-accepted",
    },
    {
      error_code: null,
      error_detail: null,
      explanation: "The rationale is not convincing.",
      finding_id: "finding-denied",
      outcome: "denied",
      request_id: "request-denied",
    },
    {
      error_code: "required_evidence_unavailable",
      error_detail: "The frozen generated file is unavailable.",
      explanation: null,
      finding_id: "finding-error",
      outcome: "error",
      request_id: "request-error",
    },
  ]);

  assert.match(body, /^## Quality Bar Waiver Adjudication/m);
  assert.match(body, /Recomputed outcome: advisory/);
  assert.match(body, /Adjudication: `adjudication-1`/);
  assert.match(body, /Finding: `finding-accepted`[\s\S]*Decision: accepted/);
  assert.match(body, /Finding: `finding-denied`[\s\S]*Decision: denied/);
  assert.match(
    body,
    /Finding: `finding-error`[\s\S]*Decision: error[\s\S]*required_evidence_unavailable/,
  );
});

test("accepted local follow-up identifies the original Evaluation and Finding", () => {
  const body = formatWaiverDecisionFollowup(identity, {
    explanation: "The exact exception is justified.",
    finding_id: "finding-accepted",
    outcome: "accepted",
    request_id: "request-accepted",
  });

  assert.match(body, /^\*\*Quality Bar — waiver accepted\*\*/);
  assert.match(body, /Finding: `finding-accepted`/);
  assert.match(body, /Evaluation: `evaluation-1`/);
  assert.match(body, /Adjudication: `adjudication-1`/);
});

test("local follow-up rejects denied and error Decisions", () => {
  for (const outcome of ["denied", "error"]) {
    assert.throws(
      () =>
        formatWaiverDecisionFollowup(identity, {
          explanation: "Not accepted.",
          finding_id: "finding-1",
          outcome,
          request_id: "request-1",
        }),
      /Accepted Waiver Decision is required/,
    );
  }
});
