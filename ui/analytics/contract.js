import { count, exact, nonempty, record } from "../contract.js";

const rate = (value) =>
  record(value) && count(value.numerator) && count(value.denominator);

const duration = (value) =>
  record(value) &&
  count(value.execution_count) &&
  (value.total_ms === null || count(value.total_ms)) &&
  (value.median_ms === null ||
    (Number.isFinite(value.median_ms) && value.median_ms >= 0));

const counter = (value) =>
  record(value) &&
  rate(value.coverage) &&
  (value.sum === null || count(value.sum)) &&
  (value.median === null ||
    (Number.isFinite(value.median) && value.median >= 0));
const commit = (value) => /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value);
const nullableCount = (value) => value === null || count(value);
const filters = (value) =>
  record(value) &&
  Object.entries(value).every(([name, item]) => {
    if (["base_commit", "head_commit"].includes(name)) {
      return commit(item);
    }
    if (["start", "end"].includes(name)) {
      return count(item);
    }
    if (name === "pull_request_number") {
      return Number.isSafeInteger(item) && item > 0;
    }
    if (name === "terminal_outcome") {
      return ["clear", "advisory", "blocking", "error"].includes(item);
    }
    return (
      [
        "criterion_id",
        "model",
        "reasoning_effort",
        "repository_id",
        "review_id",
        "review_version_id",
        "service_tier",
      ].includes(name) && nonempty(item)
    );
  });
const evaluationFact = (value) =>
  record(value) &&
  exact(value, [
    "base_commit",
    "created_at",
    "evaluation_id",
    "head_commit",
    "pull_request_number",
    "repository_id",
    "terminal_outcome",
  ]) &&
  nonempty(value.evaluation_id) &&
  nonempty(value.repository_id) &&
  commit(value.base_commit) &&
  commit(value.head_commit) &&
  (value.pull_request_number === null ||
    (Number.isSafeInteger(value.pull_request_number) &&
      value.pull_request_number > 0)) &&
  count(value.created_at) &&
  ["clear", "advisory", "blocking", "error", "pending"].includes(
    value.terminal_outcome,
  );
const matchingFacts = (value) =>
  record(value) &&
  exact(value, ["evaluations", "review_runs"]) &&
  Array.isArray(value.evaluations) &&
  value.evaluations.every(evaluationFact) &&
  Array.isArray(value.review_runs) &&
  value.review_runs.every(
    (run) =>
      record(run) &&
      exact(run, [
        "base_commit",
        "cached_input_tokens",
        "cancellation_code",
        "completed_at",
        "created_at",
        "criterion_results",
        "error_code",
        "evaluation_id",
        "execution_status",
        "findings",
        "head_commit",
        "input_tokens",
        "model",
        "output_tokens",
        "pull_request_number",
        "reasoning_effort",
        "repository_id",
        "review_id",
        "review_run_id",
        "review_version_id",
        "service_tier",
        "started_at",
        "waiver_decisions",
        "waiver_requests",
      ]) &&
      [
        "review_run_id",
        "evaluation_id",
        "repository_id",
        "review_id",
        "review_version_id",
        "model",
        "reasoning_effort",
        "service_tier",
      ].every((name) => nonempty(run[name])) &&
      commit(run.base_commit) &&
      commit(run.head_commit) &&
      (run.pull_request_number === null ||
        (Number.isSafeInteger(run.pull_request_number) &&
          run.pull_request_number > 0)) &&
      ["queued", "running", "completed", "failed", "cancelled"].includes(
        run.execution_status,
      ) &&
      (run.cancellation_code === null ||
        ["cancelled_by_operator", "cancelled_by_supersession"].includes(
          run.cancellation_code,
        )) &&
      (run.error_code === null || /^[a-z][a-z0-9_]*$/.test(run.error_code)) &&
      ["created_at"].every((name) => count(run[name])) &&
      ["started_at", "completed_at"].every((name) =>
        nullableCount(run[name]),
      ) &&
      ["input_tokens", "cached_input_tokens", "output_tokens"].every((name) =>
        nullableCount(run[name]),
      ) &&
      Array.isArray(run.criterion_results) &&
      run.criterion_results.every(
        (item) =>
          exact(item, ["criterion_id", "outcome"]) &&
          nonempty(item.criterion_id) &&
          ["clear", "triggered", "not_applicable", "error"].includes(
            item.outcome,
          ),
      ) &&
      Array.isArray(run.findings) &&
      run.findings.every(
        (item) =>
          exact(item, ["criterion_id", "finding_id", "impact"]) &&
          nonempty(item.criterion_id) &&
          nonempty(item.finding_id) &&
          ["advisory", "blocking"].includes(item.impact),
      ) &&
      Array.isArray(run.waiver_requests) &&
      run.waiver_requests.every(
        (item) =>
          exact(item, ["created_at", "finding_id", "waiver_request_id"]) &&
          count(item.created_at) &&
          nonempty(item.finding_id) &&
          nonempty(item.waiver_request_id),
      ) &&
      Array.isArray(run.waiver_decisions) &&
      run.waiver_decisions.every(
        (item) =>
          exact(item, [
            "created_at",
            "outcome",
            "waiver_decision_id",
            "waiver_request_id",
          ]) &&
          count(item.created_at) &&
          ["accepted", "denied", "error"].includes(item.outcome) &&
          nonempty(item.waiver_decision_id) &&
          nonempty(item.waiver_request_id),
      ),
  );

const reliability = (value, outcomes) =>
  record(value) &&
  count(value.active) &&
  outcomes.every(
    (outcome) =>
      count(value[outcome]) &&
      rate(value[`${outcome}_rate`]) &&
      duration(value.duration?.[outcome]),
  ) &&
  duration(value.duration?.terminal) &&
  Array.isArray(value.failure_codes) &&
  value.failure_codes.every(
    (failure) =>
      record(failure) && nonempty(failure.code) && count(failure.count),
  ) &&
  ["input_tokens", "cached_input_tokens", "output_tokens"].every((name) =>
    counter(value.token_counters?.[name]),
  );

const outcomeRates = (value, names) =>
  record(value) &&
  names.every((name) => count(value[name]) && rate(value[`${name}_rate`]));

const analyticsRows = (value) =>
  Array.isArray(value.review_applicability) &&
  value.review_applicability.every(
    (item) =>
      record(item) &&
      nonempty(item.review_id) &&
      outcomeRates(item, ["applicable", "error"]) &&
      count(item.not_applicable),
  ) &&
  Array.isArray(value.criterion_outcomes) &&
  value.criterion_outcomes.every(
    (item) =>
      record(item) &&
      nonempty(item.criterion_id) &&
      ["triggered", "clear", "not_applicable", "error"].every((name) =>
        count(item[name]),
      ) &&
      ["trigger", "clear", "not_applicable", "error"].every((name) =>
        rate(item[`${name}_rate`]),
      ),
  );

export const validAnalytics = (value) =>
  record(value) &&
  exact(value, [
    "criterion_outcomes",
    "daily_trend",
    "evaluation_outcomes",
    "evaluation_overview",
    "finding_impact",
    "matching_facts",
    "population",
    "pull_request_criterion_transitions",
    "review_applicability",
    "review_run_reliability",
    "waiver_adjudication_reliability",
    "waiver_analytics",
  ]) &&
  record(value.evaluation_overview) &&
  exact(value.evaluation_overview, [
    "clear_count",
    "clear_rate",
    "duration_sample_count",
    "p95_duration_ms",
    "terminal_count",
    "window",
  ]) &&
  count(value.evaluation_overview.terminal_count) &&
  count(value.evaluation_overview.clear_count) &&
  rate(value.evaluation_overview.clear_rate) &&
  count(value.evaluation_overview.duration_sample_count) &&
  nullableCount(value.evaluation_overview.p95_duration_ms) &&
  record(value.evaluation_overview.window) &&
  exact(value.evaluation_overview.window, ["end", "start"]) &&
  count(value.evaluation_overview.window.start) &&
  count(value.evaluation_overview.window.end) &&
  matchingFacts(value.matching_facts) &&
  analyticsRows(value) &&
  Array.isArray(value.daily_trend) &&
  value.daily_trend.every(
    (bucket) =>
      record(bucket) &&
      nonempty(bucket.date) &&
      [
        "advisory",
        "blocking",
        "clear",
        "error",
        "evaluations",
        "pending",
      ].every((name) => count(bucket[name])),
  ) &&
  record(value.population) &&
  exact(value.population, [
    "filters",
    "matching_evaluations",
    "matching_waiver_adjudications",
    "matching_waiver_decisions",
    "matching_waiver_requests",
    "pending_adjudications",
    "pending_evaluations",
    "state",
    "total_evaluations",
  ]) &&
  filters(value.population.filters) &&
  ["no_evaluations", "no_filter_match", "pending_data", "ready"].includes(
    value.population.state,
  ) &&
  [
    "total_evaluations",
    "matching_evaluations",
    "matching_waiver_requests",
    "matching_waiver_decisions",
    "matching_waiver_adjudications",
    "pending_evaluations",
    "pending_adjudications",
  ].every((name) => count(value.population[name])) &&
  outcomeRates(value.evaluation_outcomes, [
    "clear",
    "advisory",
    "blocking",
    "error",
  ]) &&
  count(value.evaluation_outcomes.pending) &&
  record(value.finding_impact) &&
  count(value.finding_impact.advisory) &&
  count(value.finding_impact.blocking) &&
  rate(value.finding_impact.findings_per_triggered_criterion_result) &&
  record(value.waiver_analytics) &&
  count(value.waiver_analytics.advisory_findings) &&
  count(value.waiver_analytics.requested_findings) &&
  count(value.waiver_analytics.waived_findings) &&
  rate(value.waiver_analytics.waiver_request_rate) &&
  rate(value.waiver_analytics.waived_finding_rate) &&
  outcomeRates(value.waiver_analytics.decision_history, [
    "accepted",
    "denied",
    "error",
  ]) &&
  record(value.pull_request_criterion_transitions) &&
  [
    "triggered_to_clear",
    "no_longer_applicable",
    "triggered_to_error",
    "sample_size",
  ].every((name) => count(value.pull_request_criterion_transitions[name])) &&
  reliability(value.review_run_reliability, [
    "successful",
    "failed",
    "operator_cancelled",
    "superseded",
  ]) &&
  reliability(value.waiver_adjudication_reliability, [
    "completed",
    "failed",
    "cancelled",
  ]);
