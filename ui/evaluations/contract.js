import { count, nonempty, record } from "../contract.js";

const EXECUTION_STATUSES = new Set([
  "cancelled",
  "completed",
  "failed",
  "queued",
  "running",
]);
const TERMINAL_STATUSES = new Set(["cancelled", "completed", "failed"]);

/** @param {any} value */
const validError = (value) =>
  record(value) && nonempty(value.code) && nonempty(value.detail);
/** @param {any} value */
const commit = (value) => /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(value);
/** @param {any} value */
const validSelector = (value) =>
  record(value) &&
  ["branch", "commit"].includes(value.type) &&
  nonempty(value.value) &&
  (value.type !== "commit" || commit(value.value));

/** @param {unknown} value @param {string[]} names */
function validCounts(value, names) {
  return (
    record(value) &&
    names.every((name) => Number.isSafeInteger(value[name]) && value[name] >= 0)
  );
}

/** @param {unknown} value */
function validNode(value) {
  if (
    !record(value) ||
    !["review", "system"].includes(value.kind) ||
    typeof value.label !== "string" ||
    !EXECUTION_STATUSES.has(value.status)
  ) {
    return false;
  }
  return value.kind === "system"
    ? typeof value.key === "string"
    : typeof value.review_id === "string" &&
        typeof value.review_version_id === "string" &&
        (value.outcome === null ||
          ["clear", "advisory", "blocking", "error"].includes(value.outcome));
}

/** @param {unknown} value */
export function validMonitor(value) {
  return (
    record(value) &&
    Array.isArray(value.nodes) &&
    value.nodes.every(validNode) &&
    validCounts(value.review_counts, [
      "cancelled",
      "completed",
      "failed",
      "queued",
      "running",
      "total",
    ]) &&
    (value.outcome_counts === null ||
      validCounts(value.outcome_counts, [
        "clear",
        "triggered",
        "not_applicable",
        "error",
      ])) &&
    (value.finding_counts === null ||
      validCounts(value.finding_counts, ["total", "advisory", "blocking"])) &&
    (value.duration_ms === null ||
      (Number.isSafeInteger(value.duration_ms) && value.duration_ms >= 0)) &&
    value.review_counts.total ===
      value.nodes.filter((node) => node.kind === "review").length
  );
}

/** @param {unknown} value */
export function validEvaluation(value) {
  if (!record(value) || !record(value.repository) || !record(value.monitor)) {
    return false;
  }
  return (
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.repository.id === "string" &&
    value.repository.id.length > 0 &&
    typeof value.repository.url === "string" &&
    ["automatic", "explicit"].includes(value.provenance) &&
    validSelector(value.base_selector) &&
    validSelector(value.head_selector) &&
    commit(value.base_commit) &&
    commit(value.head_commit) &&
    ["ready", "exhausted"].includes(value.retry_state) &&
    (value.retry_error === null || validError(value.retry_error)) &&
    count(value.pre_start_attempt_count) &&
    (value.exhausted_at === null || nonempty(value.exhausted_at)) &&
    EXECUTION_STATUSES.has(value.execution_status) &&
    ["pending", "clear", "advisory", "blocking", "error"].includes(
      value.effective_outcome,
    ) &&
    typeof value.created_at === "string" &&
    (value.completed_at === null || typeof value.completed_at === "string") &&
    validMonitor(value.monitor)
  );
}

/** @param {unknown} value */
export function validCollection(value) {
  return (
    record(value) &&
    Array.isArray(value.items) &&
    value.items.every(validEvaluation) &&
    (value.next_cursor === null || typeof value.next_cursor === "string")
  );
}

/** @param {any} value */
const validRule = (value) =>
  value === null ||
  (record(value) &&
    value.profile === "quality-bar-restricted-cel-v1" &&
    nonempty(value.source));
/** @param {any} value */
const stringList = (value) => Array.isArray(value) && value.every(nonempty);
/** @param {any} value */
function validApplicabilityEvidence(value) {
  if (!record(value)) {
    return false;
  }
  if (value.kind === "unconditional") {
    return true;
  }
  if (value.kind === "matched") {
    return (
      Array.isArray(value.matches) &&
      value.matches.length > 0 &&
      value.matches.every(
        (match) =>
          record(match) &&
          nonempty(match.file_change_id) &&
          stringList(match.branch_ids) &&
          match.branch_ids.length > 0 &&
          stringList(match.predicate_ids) &&
          match.predicate_ids.length > 0 &&
          Array.isArray(match.sides) &&
          match.sides.length > 0 &&
          match.sides.every((side) =>
            ["change", "before", "after"].includes(side),
          ) &&
          (match.before_path === null || nonempty(match.before_path)) &&
          (match.after_path === null || nonempty(match.after_path)),
      )
    );
  }
  return (
    ["satisfied_branches", "failed_branches"].includes(value.kind) &&
    stringList(value.branch_ids) &&
    stringList(value.predicate_ids) &&
    (value.kind !== "satisfied_branches" || value.predicate_ids.length > 0)
  );
}
/** @param {any} value */
function validApplicability(value) {
  const common =
    record(value) &&
    nonempty(value.review_id) &&
    nonempty(value.review_version_id) &&
    record(value.assignment) &&
    ["installation_wide", "repository_specific"].includes(
      value.assignment.scope,
    ) &&
    validRule(value.rule);
  if (!common) {
    return false;
  }
  if (value.outcome === "error") {
    return validError(value.error);
  }
  return (
    ["applicable", "not_applicable"].includes(value.outcome) &&
    validApplicabilityEvidence(value.evidence) &&
    (value.rule === null) === (value.evidence.kind === "unconditional")
  );
}

/** @param {any} value */
function validCriterionResult(value) {
  return (
    record(value) &&
    nonempty(value.review_run_id) &&
    nonempty(value.criterion_id) &&
    ["clear", "triggered", "not_applicable", "error"].includes(value.outcome) &&
    (value.outcome !== "error" || validError(value.error))
  );
}

/** @param {any} value */
function validLocation(value) {
  if (
    !record(value) ||
    !["changeset", "whole_side", "line_range"].includes(value.kind)
  ) {
    return false;
  }
  if (value.kind === "changeset") {
    return true;
  }
  return (
    nonempty(value.file_change_id) &&
    ["base", "head"].includes(value.side) &&
    nonempty(value.path) &&
    (value.kind !== "line_range" ||
      (Number.isSafeInteger(value.start_line) &&
        value.start_line > 0 &&
        Number.isSafeInteger(value.end_line) &&
        value.end_line >= value.start_line))
  );
}

/** @param {any} value */
function validFinding(value) {
  return (
    record(value) &&
    nonempty(value.id) &&
    nonempty(value.review_run_id) &&
    nonempty(value.criterion_id) &&
    ["advisory", "blocking"].includes(value.impact) &&
    nonempty(value.evidence) &&
    nonempty(value.remediation) &&
    validLocation(value.location)
  );
}

/** @param {any} value */
const validProcess = (value) =>
  record(value) &&
  ((value.kind === "exit" && count(value.code)) ||
    (value.kind === "signal" && nonempty(value.signal)) ||
    value.kind === "unavailable");

/** @param {any} value */
const validMeasurements = (value) =>
  record(value) &&
  (value.codex_cli_version === null || nonempty(value.codex_cli_version)) &&
  (value.duration_ms === null || count(value.duration_ms)) &&
  validProcess(value.process) &&
  record(value.token_counters) &&
  ["input_tokens", "cached_input_tokens", "output_tokens"].every(
    (name) =>
      value.token_counters[name] === null || count(value.token_counters[name]),
  );

/** @param {any} value @param {string} evaluationId */
function validReviewRun(value, evaluationId) {
  return (
    record(value) &&
    nonempty(value.id) &&
    value.evaluation_id === evaluationId &&
    nonempty(value.review_id) &&
    nonempty(value.review_version_id) &&
    nonempty(value.created_at) &&
    (value.started_at === null || nonempty(value.started_at)) &&
    nonempty(value.completed_at) &&
    ["completed", "failed", "cancelled"].includes(value.execution_status) &&
    (value.execution_status === "cancelled" || nonempty(value.started_at)) &&
    (value.execution_status === "completed" || validError(value.error)) &&
    validMeasurements(value.measurements) &&
    Array.isArray(value.criterion_results) &&
    value.criterion_results.every(validCriterionResult) &&
    Array.isArray(value.findings) &&
    value.findings.every(validFinding)
  );
}

/** @param {any} value */
const validFileChange = (value) =>
  record(value) &&
  nonempty(value.id) &&
  ["added", "deleted", "modified", "renamed"].every(
    (name) => typeof value[name] === "boolean",
  ) &&
  ["before_path", "after_path"].every(
    (name) => value[name] === null || nonempty(value[name]),
  ) &&
  typeof value.patch === "string";

/** @param {unknown} value @param {string} evaluationId */
export function validEvaluationResult(value, evaluationId) {
  if (
    !record(value) ||
    value.evaluation_id !== evaluationId ||
    !["clear", "advisory", "blocking", "error"].includes(value.outcome) ||
    !nonempty(value.completed_at) ||
    !Array.isArray(value.applicability_results) ||
    !value.applicability_results.every(validApplicability) ||
    !Array.isArray(value.review_runs) ||
    !value.review_runs.every((run) => validReviewRun(run, evaluationId)) ||
    !Array.isArray(value.criterion_results) ||
    !value.criterion_results.every(validCriterionResult) ||
    !Array.isArray(value.file_changes) ||
    !value.file_changes.every(validFileChange) ||
    !Array.isArray(value.findings) ||
    !value.findings.every(validFinding)
  ) {
    return false;
  }
  const runs = new Set(value.review_runs.map((run) => run.id));
  const criteria = new Set(
    value.criterion_results.map(
      (criterion) => `${criterion.review_run_id}:${criterion.criterion_id}`,
    ),
  );
  const changes = new Set(value.file_changes.map((change) => change.id));
  return (
    value.criterion_results.every((criterion) =>
      runs.has(criterion.review_run_id),
    ) &&
    value.findings.every(
      (finding) =>
        runs.has(finding.review_run_id) &&
        criteria.has(`${finding.review_run_id}:${finding.criterion_id}`) &&
        (finding.location.kind === "changeset" ||
          changes.has(finding.location.file_change_id)),
    )
  );
}

/** @param {any} value @param {string} reviewRunId */
export function validReviewRunDiagnostics(value, reviewRunId) {
  /** @param {any} item */
  const counter = (item) =>
    item === null || (Number.isSafeInteger(item) && item >= 0);
  return (
    record(value) &&
    value.review_run_id === reviewRunId &&
    (value.started_at === null || nonempty(value.started_at)) &&
    (value.completed_at === null || nonempty(value.completed_at)) &&
    (value.codex_cli_version === null || nonempty(value.codex_cli_version)) &&
    counter(value.duration_ms) &&
    validProcess(value.process) &&
    record(value.token_counters) &&
    ["input_tokens", "cached_input_tokens", "output_tokens"].every((name) =>
      counter(value.token_counters[name]),
    ) &&
    Array.isArray(value.transcript_chunks) &&
    value.transcript_chunks.every(
      (chunk) =>
        record(chunk) &&
        Number.isSafeInteger(chunk.sequence) &&
        chunk.sequence > 0 &&
        ["stdout", "stderr"].includes(chunk.stream) &&
        nonempty(chunk.content),
    )
  );
}

/** @param {string} status */
export const isTerminalStatus = (status) => TERMINAL_STATUSES.has(status);

/** @param {unknown} node */
export function nodeVisualState(node) {
  if (!record(node)) {
    return "pending";
  }
  if (node.status === "failed" || node.outcome === "error") {
    return "error";
  }
  if (node.outcome === "blocking") {
    return "blocking";
  }
  if (node.outcome === "advisory") {
    return "advisory";
  }
  if (node.status === "completed") {
    return "complete";
  }
  return node.status === "running" ? "running" : "pending";
}

/** @param {string} action @param {string} evaluationId @param {string} csrf */
export function mutateEvaluation(action, evaluationId, csrf) {
  if (!["cancel", "retry"].includes(action) || !evaluationId || !csrf) {
    throw new TypeError("Evaluation monitor mutation is invalid");
  }
  return fetch(
    `/api/v1/evaluations/${encodeURIComponent(evaluationId)}/${action}`,
    {
      headers: {
        ...(action === "retry"
          ? { "idempotency-key": crypto.randomUUID() }
          : {}),
        "x-quality-bar-csrf": csrf,
      },
      method: "POST",
    },
  );
}
