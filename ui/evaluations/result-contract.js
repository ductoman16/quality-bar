import { count, nonempty, record } from "../contract.js";

/** @param {any} value */
const timestamp = (value) =>
  nonempty(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;
/** @param {any} value */
const validError = (value) =>
  record(value) &&
  Object.keys(value).length === 2 &&
  /^[a-z][a-z0-9_]*$/.test(value.code) &&
  nonempty(value.detail);
/** @param {any} value @param {string[]} names */
const exact = (value, names) =>
  Object.keys(value).length === names.length &&
  names.every((name) => Object.hasOwn(value, name));
/** @param {any} value */
const stringList = (value) => Array.isArray(value) && value.every(nonempty);
/** @param {any} value */
const validRule = (value) =>
  value === null ||
  (record(value) &&
    exact(value, ["profile", "source"]) &&
    value.profile === "quality-bar-restricted-cel-v1" &&
    nonempty(value.source));

/** @param {any} value */
function validApplicabilityEvidence(value) {
  if (!record(value)) {
    return false;
  }
  if (value.kind === "unconditional") {
    return exact(value, ["kind"]);
  }
  if (value.kind === "matched") {
    return (
      Array.isArray(value.matches) &&
      value.matches.length > 0 &&
      value.matches.every(
        (match) =>
          record(match) &&
          exact(match, [
            "after_path",
            "before_path",
            "branch_ids",
            "file_change_id",
            "predicate_ids",
            "sides",
          ]) &&
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
    exact(value, ["branch_ids", "kind", "predicate_ids"]) &&
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
    exact(value.assignment, ["scope"]) &&
    ["installation_wide", "repository_specific"].includes(
      value.assignment.scope,
    );
  if (!common) {
    return false;
  }
  if (value.outcome === "error") {
    const error = value.error;
    return (
      exact(value, [
        "assignment",
        "error",
        "outcome",
        "review_id",
        "review_version_id",
        "rule",
      ]) &&
      validRule(value.rule) &&
      value.rule !== null &&
      record(error) &&
      Object.keys(error).every((name) =>
        ["code", "detail", "file_change_id", "predicate_id", "side"].includes(
          name,
        ),
      ) &&
      /^[a-z][a-z0-9_]*$/.test(error.code) &&
      nonempty(error.detail) &&
      (error.file_change_id === undefined || nonempty(error.file_change_id)) &&
      (error.predicate_id === undefined ||
        /^predicate-[1-9][0-9]*$/.test(error.predicate_id)) &&
      (error.side === undefined || ["before", "after"].includes(error.side))
    );
  }
  const evidenceKind = value.evidence?.kind;
  return (
    ["applicable", "not_applicable"].includes(value.outcome) &&
    exact(value, [
      "assignment",
      "evidence",
      "outcome",
      "review_id",
      "review_version_id",
      "rule",
    ]) &&
    validRule(value.rule) &&
    validApplicabilityEvidence(value.evidence) &&
    (value.outcome === "applicable"
      ? value.rule === null
        ? evidenceKind === "unconditional"
        : ["satisfied_branches", "matched"].includes(evidenceKind)
      : value.rule !== null && evidenceKind === "failed_branches")
  );
}

/** @param {any} value */
function validCriterionResult(value) {
  const error = value?.outcome === "error";
  return (
    record(value) &&
    exact(value, [
      "criterion_id",
      ...(error ? ["error"] : []),
      "outcome",
      "review_run_id",
    ]) &&
    nonempty(value.review_run_id) &&
    nonempty(value.criterion_id) &&
    ["clear", "triggered", "not_applicable", "error"].includes(value.outcome) &&
    (!error || validError(value.error))
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
    return exact(value, ["kind"]);
  }
  if (
    !exact(value, [
      ...(value.kind === "line_range" ? ["end_line"] : []),
      "file_change_id",
      "kind",
      "path",
      "side",
      ...(value.kind === "line_range" ? ["start_line"] : []),
    ])
  ) {
    return false;
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
    exact(value, [
      "criterion_id",
      "evidence",
      "id",
      "impact",
      "location",
      "remediation",
      "review_run_id",
    ]) &&
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
  ((value.kind === "exit" &&
    Object.keys(value).length === 2 &&
    count(value.code)) ||
    (value.kind === "signal" &&
      Object.keys(value).length === 2 &&
      nonempty(value.signal)) ||
    (value.kind === "unavailable" && Object.keys(value).length === 1));

/** @param {any} value */
const validMeasurements = (value) =>
  record(value) &&
  exact(value, [
    "codex_cli_version",
    "duration_ms",
    "process",
    "token_counters",
  ]) &&
  (value.codex_cli_version === null || nonempty(value.codex_cli_version)) &&
  (value.duration_ms === null || count(value.duration_ms)) &&
  validProcess(value.process) &&
  record(value.token_counters) &&
  exact(value.token_counters, [
    "cached_input_tokens",
    "input_tokens",
    "output_tokens",
  ]) &&
  ["input_tokens", "cached_input_tokens", "output_tokens"].every(
    (name) =>
      value.token_counters[name] === null || count(value.token_counters[name]),
  );

/** @param {any} value @param {string} evaluationId */
function validReviewRun(value, evaluationId) {
  const error = value?.execution_status !== "completed";
  return (
    record(value) &&
    exact(value, [
      "completed_at",
      "created_at",
      "criterion_results",
      ...(error ? ["error"] : []),
      "evaluation_id",
      "execution_status",
      "findings",
      "id",
      "measurements",
      "review_id",
      "review_version_id",
      "started_at",
    ]) &&
    nonempty(value.id) &&
    value.evaluation_id === evaluationId &&
    nonempty(value.review_id) &&
    nonempty(value.review_version_id) &&
    timestamp(value.created_at) &&
    (value.started_at === null || timestamp(value.started_at)) &&
    timestamp(value.completed_at) &&
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
  exact(value, [
    "added",
    "after_path",
    "before_path",
    "deleted",
    "id",
    "modified",
    "patch",
    "renamed",
  ]) &&
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
    !exact(value, [
      "applicability_results",
      "completed_at",
      "criterion_results",
      "evaluation_id",
      "file_changes",
      "findings",
      "outcome",
      "review_runs",
    ]) ||
    value.evaluation_id !== evaluationId ||
    !["clear", "advisory", "blocking", "error"].includes(value.outcome) ||
    !timestamp(value.completed_at) ||
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
  const counter = (item) => item === null || count(item);
  return (
    record(value) &&
    exact(value, [
      "codex_cli_version",
      "completed_at",
      "duration_ms",
      "process",
      "review_run_id",
      "started_at",
      "token_counters",
      "transcript_chunks",
    ]) &&
    value.review_run_id === reviewRunId &&
    (value.started_at === null || timestamp(value.started_at)) &&
    (value.completed_at === null || timestamp(value.completed_at)) &&
    (value.codex_cli_version === null || nonempty(value.codex_cli_version)) &&
    counter(value.duration_ms) &&
    validProcess(value.process) &&
    record(value.token_counters) &&
    exact(value.token_counters, [
      "cached_input_tokens",
      "input_tokens",
      "output_tokens",
    ]) &&
    ["input_tokens", "cached_input_tokens", "output_tokens"].every((name) =>
      counter(value.token_counters[name]),
    ) &&
    Array.isArray(value.transcript_chunks) &&
    value.transcript_chunks.every(
      (chunk) =>
        record(chunk) &&
        exact(chunk, ["content", "sequence", "stream"]) &&
        Number.isSafeInteger(chunk.sequence) &&
        chunk.sequence > 0 &&
        ["stdout", "stderr"].includes(chunk.stream) &&
        nonempty(chunk.content),
    )
  );
}
