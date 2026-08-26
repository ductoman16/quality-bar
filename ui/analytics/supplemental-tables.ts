const measurement = (value: any) => (value === null ? "—" : value);

export function supplementalTables(value: any, rate: (value: any) => string) {
  const runs = value.review_run_reliability;
  const adjudications = value.waiver_adjudication_reliability;
  const waivers = value.waiver_analytics;
  return [
    {
      title: "Matching Evaluation facts",
      headers: [
        "Evaluation",
        "Repository",
        "Base",
        "Head",
        "Pull request",
        "Created",
        "Outcome",
      ],
      rows: value.matching_facts.evaluations.map((fact: any) => [
        fact.evaluation_id,
        fact.repository_id,
        fact.base_commit,
        fact.head_commit,
        fact.pull_request_number ?? "—",
        fact.created_at,
        fact.terminal_outcome,
      ]),
    },
    {
      title: "Matching Review Run facts",
      headers: [
        "Review Run",
        "Evaluation",
        "Review",
        "Version",
        "Model",
        "Status",
        "Criteria",
        "Findings",
        "Waiver requests",
        "Waiver decisions",
      ],
      rows: value.matching_facts.review_runs.map((fact: any) => [
        fact.review_run_id,
        fact.evaluation_id,
        fact.review_id,
        fact.review_version_id,
        `${fact.model}/${fact.reasoning_effort}/${fact.service_tier}`,
        fact.execution_status,
        fact.criterion_results.length,
        fact.findings.length,
        fact.waiver_requests.length,
        fact.waiver_decisions.length,
      ]),
    },
    {
      title: "Pull-request Criterion transitions",
      headers: [
        "Triggered-to-clear",
        "No longer applicable",
        "Triggered-to-error",
        "Sample size",
      ],
      rows: [
        [
          value.pull_request_criterion_transitions.triggered_to_clear,
          value.pull_request_criterion_transitions.no_longer_applicable,
          value.pull_request_criterion_transitions.triggered_to_error,
          value.pull_request_criterion_transitions.sample_size,
        ],
      ],
    },
    {
      title: "Decision history",
      headers: [
        "Accepted",
        "Denied",
        "Error",
        "Accepted share",
        "Denied share",
        "Error share",
      ],
      rows: [
        [
          waivers.decision_history.accepted,
          waivers.decision_history.denied,
          waivers.decision_history.error,
          rate(waivers.decision_history.accepted_rate),
          rate(waivers.decision_history.denied_rate),
          rate(waivers.decision_history.error_rate),
        ],
      ],
    },
    {
      title: "Execution failure codes",
      headers: ["Execution kind", "Failure code", "Count"],
      rows: [
        ...runs.failure_codes.map((failure: any) => [
          "Review Run",
          failure.code,
          failure.count,
        ]),
        ...adjudications.failure_codes.map((failure: any) => [
          "Waiver Adjudication",
          failure.code,
          failure.count,
        ]),
      ],
    },
    {
      title: "Execution duration",
      headers: [
        "Execution kind",
        "Outcome",
        "Executions",
        "Total ms",
        "Median ms",
      ],
      rows: [
        ...[
          ["terminal", "Terminal"],
          ["successful", "Successful"],
          ["failed", "Failed"],
          ["operator_cancelled", "Operator-cancelled"],
          ["superseded", "Superseded"],
        ].map(([outcome, label]) => [
          "Review Run",
          label,
          runs.duration[outcome].execution_count,
          measurement(runs.duration[outcome].total_ms),
          measurement(runs.duration[outcome].median_ms),
        ]),
        ...[
          ["terminal", "Terminal"],
          ["completed", "Completed"],
          ["failed", "Failed"],
          ["cancelled", "Cancelled"],
        ].map(([outcome, label]) => [
          "Waiver Adjudication",
          label,
          adjudications.duration[outcome].execution_count,
          measurement(adjudications.duration[outcome].total_ms),
          measurement(adjudications.duration[outcome].median_ms),
        ]),
      ],
    },
    {
      title: "Token counters",
      headers: ["Execution kind", "Counter", "Sum", "Median", "Coverage"],
      rows: [
        ["Review Run", runs],
        ["Waiver Adjudication", adjudications],
      ].flatMap(([kind, reliability]) =>
        [
          ["input_tokens", "Input tokens"],
          ["cached_input_tokens", "Cached input tokens"],
          ["output_tokens", "Output tokens"],
        ].map(([counter, label]) => [
          kind,
          label,
          measurement(reliability.token_counters[counter].sum),
          measurement(reliability.token_counters[counter].median),
          rate(reliability.token_counters[counter].coverage),
        ]),
      ),
    },
  ];
}
