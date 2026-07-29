export const TRIGGERED_EVALUATION_RESULT = {
  applicability_results: [],
  completed_at: "2026-07-28T12:00:00.000Z",
  criterion_results: [
    {
      criterion_id: "criterion-1",
      outcome: "triggered",
      review_run_id: "review-run-1",
    },
  ],
  evaluation_id: "evaluation-1",
  findings: [
    {
      criterion_id: "criterion-1",
      evidence: "The changed branch returns stale state.",
      id: "finding-1",
      impact: "blocking",
      location: {
        end_line: 3,
        file_change_id: "file-change-1",
        kind: "line_range",
        path: "src/current.js",
        side: "head",
        start_line: 2,
      },
      remediation: "Return the newly computed state.",
      review_run_id: "review-run-1",
    },
  ],
  outcome: "blocking",
  review_runs: [
    {
      completed_at: "2026-07-28T12:00:00.000Z",
      id: "review-run-1",
      review_id: "review-1",
      review_version_id: "review-version-1",
      started_at: "2026-07-28T11:59:00.000Z",
      status: "completed",
    },
  ],
};
