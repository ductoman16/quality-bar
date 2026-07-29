import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ReviewRunExecutionError,
  validateReviewRunSubmission,
} from "../src/review-run-result.js";

const criteria = [
  { criterion_id: "criterion-1", impact: "blocking" },
  { criterion_id: "criterion-2", impact: "advisory" },
];
const fileChanges = [
  {
    after_path: "src/current.js",
    base_line_count: 3,
    before_path: "src/previous.js",
    head_line_count: 4,
    id: "file-change-1",
  },
];

test("a clear Review Run submission covers every frozen Criterion exactly once", () => {
  assert.deepEqual(
    validateReviewRunSubmission(
      {
        criterion_results: [
          { criterion_id: "criterion-1", outcome: "clear" },
          { criterion_id: "criterion-2", outcome: "clear" },
        ],
      },
      ["criterion-1", "criterion-2"],
    ),
    [
      { criterion_id: "criterion-1", outcome: "clear" },
      { criterion_id: "criterion-2", outcome: "clear" },
    ],
  );
});

test("a triggered Criterion accepts complete Findings at honest frozen locations", () => {
  assert.deepEqual(
    validateReviewRunSubmission(
      {
        criterion_results: [
          {
            criterion_id: "criterion-1",
            findings: [
              {
                evidence: "The base-side branch can still return stale data.",
                location: {
                  end_line: 3,
                  file_change_id: "file-change-1",
                  kind: "line_range",
                  side: "base",
                  start_line: 2,
                },
                remediation: "Remove the stale return path.",
              },
              {
                evidence: "The renamed head file has an unsafe module default.",
                location: {
                  file_change_id: "file-change-1",
                  kind: "whole_side",
                  side: "head",
                },
                remediation: "Replace the unsafe module default.",
              },
              {
                evidence: "The combined Changeset omits the required caller.",
                location: { kind: "changeset" },
                remediation: "Add the matching caller change.",
              },
            ],
            outcome: "triggered",
          },
          { criterion_id: "criterion-2", outcome: "clear" },
        ],
      },
      criteria,
      fileChanges,
    ),
    [
      {
        criterion_id: "criterion-1",
        findings: [
          {
            evidence: "The base-side branch can still return stale data.",
            location: {
              end_line: 3,
              file_change_id: "file-change-1",
              kind: "line_range",
              side: "base",
              start_line: 2,
            },
            remediation: "Remove the stale return path.",
          },
          {
            evidence: "The renamed head file has an unsafe module default.",
            location: {
              file_change_id: "file-change-1",
              kind: "whole_side",
              side: "head",
            },
            remediation: "Replace the unsafe module default.",
          },
          {
            evidence: "The combined Changeset omits the required caller.",
            location: { kind: "changeset" },
            remediation: "Add the matching caller change.",
          },
        ],
        outcome: "triggered",
      },
      { criterion_id: "criterion-2", outcome: "clear" },
    ],
  );
});

test("dishonest Finding locations and invented Finding fields fail exactly", () => {
  for (const [finding, code] of [
    [
      {
        evidence: "Outside the frozen side.",
        location: {
          end_line: 5,
          file_change_id: "file-change-1",
          kind: "line_range",
          side: "head",
          start_line: 4,
        },
        remediation: "Use an honest changed-side range.",
      },
      "finding_location_line_range_invalid",
    ],
    [
      {
        evidence: "Invented file.",
        location: {
          file_change_id: "file-change-missing",
          kind: "whole_side",
          side: "head",
        },
        remediation: "Use a frozen File Change.",
      },
      "finding_location_file_change_invalid",
    ],
    [
      {
        evidence: "Invented Changeset file.",
        location: { file_change_id: "file-change-1", kind: "changeset" },
        remediation: "Omit the file.",
      },
      "finding_location_invalid",
    ],
    [
      {
        evidence: "Invented model.",
        location: { kind: "changeset" },
        remediation: "Keep one primary location.",
        severity: "high",
      },
      "finding_invalid",
    ],
  ]) {
    assert.throws(
      () =>
        validateReviewRunSubmission(
          {
            criterion_results: [
              {
                criterion_id: "criterion-1",
                findings: [finding],
                outcome: "triggered",
              },
              { criterion_id: "criterion-2", outcome: "clear" },
            ],
          },
          criteria,
          fileChanges,
        ),
      (error) =>
        error instanceof ReviewRunExecutionError && error.code === code,
    );
  }
});

test("unsupported or incomplete submissions fail with their exact owning error", () => {
  for (const [candidate, code] of [
    [
      {
        criterion_results: [{ criterion_id: "criterion-1", outcome: "clear" }],
      },
      "criterion_result_coverage_invalid",
    ],
    [
      {
        criterion_results: [
          { criterion_id: "criterion-1", outcome: "clear" },
          { criterion_id: "criterion-1", outcome: "clear" },
        ],
      },
      "criterion_result_coverage_invalid",
    ],
    [
      {
        criterion_results: [
          { criterion_id: "criterion-1", outcome: "triggered" },
          { criterion_id: "criterion-2", outcome: "clear" },
        ],
      },
      "criterion_result_invalid",
    ],
  ]) {
    assert.throws(
      () => validateReviewRunSubmission(candidate, criteria, fileChanges),
      (error) =>
        error instanceof ReviewRunExecutionError && error.code === code,
    );
  }
});
