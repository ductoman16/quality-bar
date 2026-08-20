import { count, nonempty, record } from "../contract.js";

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
