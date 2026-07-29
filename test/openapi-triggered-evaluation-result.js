export const TRIGGERED_EVALUATION_RESULT = {
  applicability_results: [],
  completed_at: "2026-07-28T12:00:00.000Z",
  criterion_results: [
    {
      criterion_id: "criterion-1",
      outcome: "triggered",
      review_run_id: "review-run-1",
    },
    {
      criterion_id: "criterion-2",
      outcome: "not_applicable",
      review_run_id: "review-run-1",
    },
    {
      criterion_id: "criterion-3",
      error: {
        code: "required_evidence_unavailable",
        detail: "The required generated file is absent from the head.",
      },
      outcome: "error",
      review_run_id: "review-run-1",
    },
  ],
  evaluation_id: "evaluation-1",
  file_changes: [
    {
      added: false,
      after_path: "src/current.js",
      before_path: "src/previous.js",
      deleted: false,
      id: "file-change-1",
      modified: true,
      patch:
        "@@ -1,3 +1,3 @@\n unchanged\n-old state\n+new state\n unchanged\n",
      renamed: true,
    },
  ],
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
  outcome: "error",
  review_runs: [
    {
      completed_at: "2026-07-28T12:00:00.000Z",
      created_at: "2026-07-28T11:58:00.000Z",
      criterion_results: [
        {
          criterion_id: "criterion-1",
          outcome: "triggered",
          review_run_id: "review-run-1",
        },
        {
          criterion_id: "criterion-2",
          outcome: "not_applicable",
          review_run_id: "review-run-1",
        },
        {
          criterion_id: "criterion-3",
          error: {
            code: "required_evidence_unavailable",
            detail: "The required generated file is absent from the head.",
          },
          outcome: "error",
          review_run_id: "review-run-1",
        },
      ],
      evaluation_id: "evaluation-1",
      execution_status: "completed",
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
      id: "review-run-1",
      measurements: {
        codex_cli_version: "0.145.0",
        duration_ms: 60_000,
        process: { code: 0, kind: "exit" },
        token_counters: {
          cached_input_tokens: 200,
          input_tokens: 1_000,
          output_tokens: 400,
        },
      },
      review_id: "review-1",
      review_version_id: "review-version-1",
      started_at: "2026-07-28T11:59:00.000Z",
    },
  ],
};

export const FAILED_REVIEW_RUN_EVALUATION_RESULT = {
  applicability_results: [],
  completed_at: "2026-07-28T12:00:00.000Z",
  criterion_results: [
    {
      criterion_id: "criterion-completed-sibling",
      outcome: "clear",
      review_run_id: "review-run-completed-sibling",
    },
  ],
  evaluation_id: "evaluation-run-failed",
  file_changes: [],
  findings: [],
  outcome: "error",
  review_runs: [
    {
      completed_at: "2026-07-28T11:59:30.000Z",
      created_at: "2026-07-28T11:58:00.000Z",
      criterion_results: [
        {
          criterion_id: "criterion-completed-sibling",
          outcome: "clear",
          review_run_id: "review-run-completed-sibling",
        },
      ],
      evaluation_id: "evaluation-run-failed",
      execution_status: "completed",
      findings: [],
      id: "review-run-completed-sibling",
      measurements: {
        codex_cli_version: "0.145.0",
        duration_ms: 60_000,
        process: { code: 0, kind: "exit" },
        token_counters: {
          cached_input_tokens: 0,
          input_tokens: 100,
          output_tokens: 25,
        },
      },
      review_id: "review-completed",
      review_version_id: "review-version-completed",
      started_at: "2026-07-28T11:58:30.000Z",
    },
    {
      completed_at: "2026-07-28T12:00:00.000Z",
      created_at: "2026-07-28T11:58:00.000Z",
      criterion_results: [],
      error: {
        code: "configuration_unavailable",
        detail: "Network-disabled Codex launch could not be constructed.",
      },
      evaluation_id: "evaluation-run-failed",
      execution_status: "failed",
      findings: [],
      id: "review-run-failed",
      measurements: {
        codex_cli_version: "0.145.0",
        duration_ms: 60_000,
        process: { code: 1, kind: "exit" },
        token_counters: {
          cached_input_tokens: null,
          input_tokens: null,
          output_tokens: null,
        },
      },
      review_id: "review-1",
      review_version_id: "review-version-1",
      started_at: "2026-07-28T11:59:00.000Z",
    },
  ],
};
