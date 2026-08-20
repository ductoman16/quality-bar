import { count, exact, nonempty, record } from "../contract.js";

const commit = (value) => /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value);
const nullableCount = (value) => value === null || count(value);

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

export const validMatchingFacts = (value) =>
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
      count(run.created_at) &&
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
