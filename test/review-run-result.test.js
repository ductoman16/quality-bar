import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ReviewRunExecutionError,
  validateReviewRunSubmission,
} from "../src/review/review-run-result.js";

const criteria = [
  { criterion_id: "criterion-1", impact: "blocking" },
  { criterion_id: "criterion-2", impact: "advisory" },
];
const fileChanges = [
  {
    added: false,
    after_path: "src/current.js",
    base_line_count: 3,
    before_path: "src/previous.js",
    deleted: false,
    head_line_count: 4,
    id: "file-change-1",
    modified: true,
    renamed: true,
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
      criteria,
      [],
    ),
    [
      { criterion_id: "criterion-1", outcome: "clear" },
      { criterion_id: "criterion-2", outcome: "clear" },
    ],
  );
  assert.throws(
    () =>
      validateReviewRunSubmission(
        { criterion_results: [] },
        [],
        /** @type {any} */ (undefined),
      ),
    /Frozen File Changes are required/,
  );
});

test("not-applicable and error Criterion Results preserve distinct complete meanings", () => {
  assert.deepEqual(
    validateReviewRunSubmission(
      {
        criterion_results: [
          { criterion_id: "criterion-1", outcome: "not_applicable" },
          {
            criterion_id: "criterion-2",
            error: {
              code: "required_evidence_unavailable",
              detail: "The required generated file is not present at head.",
            },
            outcome: "error",
          },
        ],
      },
      criteria,
      [],
    ),
    [
      { criterion_id: "criterion-1", outcome: "not_applicable" },
      {
        criterion_id: "criterion-2",
        error: {
          code: "required_evidence_unavailable",
          detail: "The required generated file is not present at head.",
        },
        outcome: "error",
      },
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

test("missing, duplicate, malformed, extra, incomplete, and finding-less submissions fail exactly", () => {
  for (const [candidate, code, message] of [
    [
      null,
      "review_run_submission_invalid",
      "Review Run submission must contain only criterion_results",
    ],
    [
      {
        criterion_results: [{ criterion_id: "criterion-1", outcome: "clear" }],
      },
      "criterion_result_coverage_invalid",
      "Criterion Results must cover every frozen Criterion exactly once and in order",
    ],
    [
      {
        criterion_results: [
          { criterion_id: "criterion-1", outcome: "clear" },
          { criterion_id: "criterion-1", outcome: "clear" },
        ],
      },
      "criterion_result_coverage_invalid",
      "Criterion Results must cover every frozen Criterion exactly once and in order",
    ],
    [
      {
        criterion_results: [
          { criterion_id: "criterion-1", outcome: "clear" },
          { criterion_id: "criterion-extra", outcome: "clear" },
        ],
      },
      "criterion_result_coverage_invalid",
      "Criterion Results must cover every frozen Criterion exactly once and in order",
    ],
    [
      {
        criterion_results: [
          { criterion_id: "criterion-1", outcome: "triggered" },
          { criterion_id: "criterion-2", outcome: "clear" },
        ],
      },
      "criterion_result_invalid",
      "Criterion Result must contain its exact outcome fields",
    ],
    [
      {
        criterion_results: [
          {
            criterion_id: "criterion-1",
            findings: [],
            outcome: "not_applicable",
          },
          { criterion_id: "criterion-2", outcome: "clear" },
        ],
      },
      "criterion_result_invalid",
      "Criterion Result must contain its exact outcome fields",
    ],
    [
      {
        criterion_results: [
          {
            criterion_id: "criterion-1",
            error: {
              code: "required_evidence_unavailable",
              detail: " ",
            },
            outcome: "error",
          },
          { criterion_id: "criterion-2", outcome: "clear" },
        ],
      },
      "criterion_result_invalid",
      "Criterion Result must contain its exact outcome fields",
    ],
    [
      {
        criterion_results: [
          {
            criterion_id: "criterion-1",
            error: {
              code: "required_evidence_unavailable",
              detail: "The required generated file is not present.",
            },
            findings: [
              {
                evidence: "Invented concern.",
                location: { kind: "changeset" },
                remediation: "Do not invent a Finding.",
              },
            ],
            outcome: "error",
          },
          { criterion_id: "criterion-2", outcome: "clear" },
        ],
      },
      "criterion_result_invalid",
      "Criterion Result must contain its exact outcome fields",
    ],
  ]) {
    assert.throws(
      () => validateReviewRunSubmission(candidate, criteria, fileChanges),
      (error) => {
        assert.ok(error instanceof ReviewRunExecutionError);
        assert.equal(error.code, code);
        assert.equal(error.message, message);
        return true;
      },
    );
  }
});
