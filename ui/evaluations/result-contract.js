import {
  count,
  exact,
  nonempty,
  numberedId,
  record,
  requiredTimestamp as timestamp,
} from "../contract.js";
const validError = (/** @type {any} */ value) =>
  record(value) &&
  exact(value, ["code", "detail"]) &&
  nonempty(value.code) &&
  /^[a-z][a-z0-9_]*$/.test(value.code) &&
  nonempty(value.detail);
const validRule = (/** @type {any} */ value) =>
  value === null ||
  (record(value) &&
    exact(value, ["profile", "source"]) &&
    value.profile === "quality-bar-restricted-cel-v1" &&
    nonempty(value.source));
/** @returns {any} */
const ordered = (/** @type {any} */ value) =>
  Array.isArray(value)
    ? value.map(ordered)
    : record(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((name) => [name, ordered(value[name])]),
        )
      : value;
const same = (/** @type {any} */ left, /** @type {any} */ right) =>
  JSON.stringify(ordered(left)) === JSON.stringify(ordered(right));
function validApplicabilityEvidence(/** @type {any} */ value) {
  if (!record(value)) {
    return false;
  }
  if (value.kind === "unconditional") {
    return exact(value, ["kind"]);
  }
  if (value.kind === "matched") {
    return (
      exact(value, ["kind", "matches"]) &&
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
          Array.isArray(match.branch_ids) &&
          match.branch_ids.every((id) => numberedId(id, "branch")) &&
          match.branch_ids.length > 0 &&
          Array.isArray(match.predicate_ids) &&
          match.predicate_ids.every((id) => numberedId(id, "predicate")) &&
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
    Array.isArray(value.branch_ids) &&
    value.branch_ids.every((id) => numberedId(id, "branch")) &&
    Array.isArray(value.predicate_ids) &&
    value.predicate_ids.every((id) => numberedId(id, "predicate")) &&
    (value.kind !== "satisfied_branches" || value.predicate_ids.length > 0)
  );
}
function validApplicability(/** @type {any} */ value) {
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
      nonempty(error.code) &&
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
function validCriterionResult(/** @type {any} */ value) {
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

function validLocation(/** @type {any} */ value) {
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

function validFinding(/** @type {any} */ value) {
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

export const validProcess = (/** @type {any} */ value) =>
  record(value) &&
  ((value.kind === "exit" &&
    Object.keys(value).length === 2 &&
    count(value.code)) ||
    (value.kind === "signal" &&
      Object.keys(value).length === 2 &&
      nonempty(value.signal)) ||
    (value.kind === "unavailable" && Object.keys(value).length === 1));

const validMeasurements = (/** @type {any} */ value) =>
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

function validReviewRun(
  /** @type {any} */ value,
  /** @type {string} */ evaluationId,
) {
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
    (value.execution_status !== "cancelled" ||
      ["cancelled_by_operator", "cancelled_by_supersession"].includes(
        value.error.code,
      )) &&
    validMeasurements(value.measurements) &&
    Array.isArray(value.criterion_results) &&
    value.criterion_results.every(validCriterionResult) &&
    Array.isArray(value.findings) &&
    value.findings.every(validFinding)
  );
}

const validFileChange = (/** @type {any} */ value) =>
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

export function validEvaluationResult(
  /** @type {any} */ value,
  /** @type {string} */ evaluationId,
) {
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
  const findings = new Set(value.findings.map((finding) => finding.id));
  return (
    runs.size === value.review_runs.length &&
    criteria.size === value.criterion_results.length &&
    changes.size === value.file_changes.length &&
    findings.size === value.findings.length &&
    value.criterion_results.every((criterion) =>
      runs.has(criterion.review_run_id),
    ) &&
    value.review_runs.every(
      (run) =>
        same(
          run.criterion_results,
          value.criterion_results.filter(
            (/** @type {any} */ criterion) =>
              criterion.review_run_id === run.id,
          ),
        ) &&
        same(
          run.findings,
          value.findings.filter(
            (/** @type {any} */ finding) => finding.review_run_id === run.id,
          ),
        ),
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
