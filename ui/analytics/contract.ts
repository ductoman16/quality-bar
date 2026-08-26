import { count, exact, nonempty, record } from "../contract.ts";
import { validMatchingFacts } from "./matching-contract.ts";

const rate = (value: any) =>
  record(value) &&
  exact(value, ["denominator", "numerator"]) &&
  count(value.numerator) &&
  count(value.denominator);

const duration = (value: any) =>
  record(value) &&
  exact(value, ["execution_count", "median_ms", "total_ms"]) &&
  count(value.execution_count) &&
  (value.total_ms === null || count(value.total_ms)) &&
  (value.median_ms === null ||
    (Number.isFinite(value.median_ms) && value.median_ms >= 0));

const counter = (value: any) =>
  record(value) &&
  exact(value, ["coverage", "median", "sum"]) &&
  rate(value.coverage) &&
  (value.sum === null || count(value.sum)) &&
  (value.median === null ||
    (Number.isFinite(value.median) && value.median >= 0));
const commit = (value: any) =>
  nonempty(value) && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value);
const nullableCount = (value: any) => value === null || count(value);
const filters = (value: any) =>
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
const reliability = (value: any, outcomes: any) =>
  record(value) &&
  exact(value, [
    "active",
    "duration",
    "failure_codes",
    "token_counters",
    ...outcomes,
    ...outcomes.map((outcome: any) => `${outcome}_rate`),
  ]) &&
  count(value.active) &&
  outcomes.every(
    (outcome: any) =>
      count(value[outcome]) &&
      rate(value[`${outcome}_rate`]) &&
      duration(value.duration?.[outcome]),
  ) &&
  duration(value.duration?.terminal) &&
  exact(value.duration, ["terminal", ...outcomes]) &&
  Array.isArray(value.failure_codes) &&
  value.failure_codes.every(
    (failure) =>
      record(failure) &&
      exact(failure, ["code", "count"]) &&
      nonempty(failure.code) &&
      /^[a-z][a-z0-9_]*$/.test(failure.code) &&
      count(failure.count),
  ) &&
  exact(value.token_counters, [
    "cached_input_tokens",
    "input_tokens",
    "output_tokens",
  ]) &&
  ["input_tokens", "cached_input_tokens", "output_tokens"].every((name) =>
    counter(value.token_counters?.[name]),
  );

const outcomeRates = (value: any, names: any) =>
  record(value) &&
  names.every((name: any) => count(value[name]) && rate(value[`${name}_rate`]));

const analyticsRows = (value: any) =>
  Array.isArray(value.review_applicability) &&
  value.review_applicability.every(
    (item: any) =>
      record(item) &&
      exact(item, [
        "applicability_rate",
        "applicable",
        "error",
        "error_rate",
        "not_applicable",
        "review_id",
      ]) &&
      nonempty(item.review_id) &&
      ["applicable", "error", "not_applicable"].every((name) =>
        count(item[name]),
      ) &&
      rate(item.applicability_rate) &&
      rate(item.error_rate),
  ) &&
  Array.isArray(value.criterion_outcomes) &&
  value.criterion_outcomes.every(
    (item: any) =>
      record(item) &&
      exact(item, [
        "clear",
        "clear_rate",
        "criterion_id",
        "error",
        "error_rate",
        "not_applicable",
        "not_applicable_rate",
        "trigger_rate",
        "triggered",
      ]) &&
      nonempty(item.criterion_id) &&
      ["triggered", "clear", "not_applicable", "error"].every((name) =>
        count(item[name]),
      ) &&
      ["trigger", "clear", "not_applicable", "error"].every((name) =>
        rate(item[`${name}_rate`]),
      ),
  );

export const validAnalytics = (value: any) =>
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
  validMatchingFacts(value.matching_facts) &&
  analyticsRows(value) &&
  Array.isArray(value.daily_trend) &&
  value.daily_trend.every(
    (bucket) =>
      record(bucket) &&
      exact(bucket, [
        "advisory",
        "blocking",
        "clear",
        "date",
        "error",
        "evaluations",
        "pending",
      ]) &&
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
  exact(value.evaluation_outcomes, [
    "advisory",
    "advisory_rate",
    "blocking",
    "blocking_rate",
    "clear",
    "clear_rate",
    "error",
    "error_rate",
    "pending",
  ]) &&
  count(value.evaluation_outcomes.pending) &&
  record(value.finding_impact) &&
  exact(value.finding_impact, [
    "advisory",
    "blocking",
    "findings_per_triggered_criterion_result",
  ]) &&
  count(value.finding_impact.advisory) &&
  count(value.finding_impact.blocking) &&
  rate(value.finding_impact.findings_per_triggered_criterion_result) &&
  record(value.waiver_analytics) &&
  exact(value.waiver_analytics, [
    "advisory_findings",
    "decision_history",
    "requested_findings",
    "waived_finding_rate",
    "waived_findings",
    "waiver_request_rate",
  ]) &&
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
  exact(value.waiver_analytics.decision_history, [
    "accepted",
    "accepted_rate",
    "denied",
    "denied_rate",
    "error",
    "error_rate",
  ]) &&
  record(value.pull_request_criterion_transitions) &&
  exact(value.pull_request_criterion_transitions, [
    "no_longer_applicable",
    "sample_size",
    "triggered_to_clear",
    "triggered_to_error",
  ]) &&
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
