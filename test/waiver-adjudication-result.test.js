import assert from "node:assert/strict";
import test from "node:test";

import { validateWaiverAdjudicationSubmission } from "../src/waiver-adjudication-result.js";

const requests = [{ id: "request-1" }, { id: "request-2" }];

test("one complete Decision is required for every selected Request", () => {
  assert.deepEqual(
    validateWaiverAdjudicationSubmission(
      {
        decisions: [
          {
            explanation: "The exact exception is justified.",
            outcome: "accepted",
            request_id: "request-1",
          },
          {
            explanation: "The rationale does not justify an exception.",
            outcome: "denied",
            request_id: "request-2",
          },
        ],
      },
      requests,
    ),
    [
      {
        explanation: "The exact exception is justified.",
        outcome: "accepted",
        request_id: "request-1",
      },
      {
        explanation: "The rationale does not justify an exception.",
        outcome: "denied",
        request_id: "request-2",
      },
    ],
  );
});

for (const [name, candidate] of [
  [
    "partial",
    {
      decisions: [
        {
          outcome: "accepted",
          request_id: "request-1",
          explanation: "Accepted.",
        },
      ],
    },
  ],
  [
    "duplicate",
    {
      decisions: [
        {
          outcome: "accepted",
          request_id: "request-1",
          explanation: "Accepted.",
        },
        { outcome: "denied", request_id: "request-1", explanation: "Denied." },
      ],
    },
  ],
  [
    "reversed",
    {
      decisions: [
        { outcome: "denied", request_id: "request-2", explanation: "Denied." },
        {
          outcome: "accepted",
          request_id: "request-1",
          explanation: "Accepted.",
        },
      ],
    },
  ],
  [
    "extra",
    {
      decisions: [
        {
          outcome: "accepted",
          request_id: "request-1",
          explanation: "Accepted.",
        },
        { outcome: "denied", request_id: "request-2", explanation: "Denied." },
        {
          outcome: "error",
          request_id: "request-3",
          error: { code: "evidence_unavailable", detail: "Missing." },
        },
      ],
    },
  ],
]) {
  test(`${name} Decision submissions are rejected`, () => {
    assert.throws(
      () => validateWaiverAdjudicationSubmission(candidate, requests),
      (error) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "waiver_adjudication_submission_invalid",
    );
  });
}

test("error Decisions require stable exact detail and no explanation", () => {
  assert.deepEqual(
    validateWaiverAdjudicationSubmission(
      {
        decisions: [
          {
            error: {
              code: "required_evidence_unavailable",
              detail: "The frozen binary side cannot be inspected.",
            },
            outcome: "error",
            request_id: "request-1",
          },
        ],
      },
      [{ id: "request-1" }],
    ),
    [
      {
        error: {
          code: "required_evidence_unavailable",
          detail: "The frozen binary side cannot be inspected.",
        },
        outcome: "error",
        request_id: "request-1",
      },
    ],
  );
});
