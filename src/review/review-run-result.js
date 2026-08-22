export class ReviewRunExecutionError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {ErrorOptions} [options]
   */
  constructor(code, message, options) {
    super(message, options);
    this.name = "ReviewRunExecutionError";
    this.code = code;
  }
}

/**
 * @param {string} code
 * @param {string} message
 * @returns {never}
 */
function fail(code, message) {
  throw new ReviewRunExecutionError(code, message);
}

/**
 * @param {unknown} candidate
 * @param {{criterion_id: string, impact: string}[]} criteria
 * @param {{id: string, before_path: string | null, after_path: string | null, base_line_count: number | null, head_line_count: number | null, patch?: string}[]} fileChanges
 */
export function validateReviewRunSubmission(candidate, criteria, fileChanges) {
  if (!Array.isArray(fileChanges)) {
    throw new TypeError("Frozen File Changes are required");
  }
  if (
    !candidate ||
    Array.isArray(candidate) ||
    typeof candidate !== "object" ||
    Object.getPrototypeOf(candidate) !== Object.prototype ||
    Object.keys(candidate).length !== 1 ||
    !Array.isArray(
      /** @type {{criterion_results?: unknown}} */ (candidate)
        .criterion_results,
    )
  ) {
    fail(
      "review_run_submission_invalid",
      "Review Run submission must contain only criterion_results",
    );
  }
  const criterionIds = criteria.map(
    ({ criterion_id: criterionId }) => criterionId,
  );
  const results = /** @type {any[]} */ (
    /** @type {{criterion_results: unknown[]}} */ (candidate).criterion_results
  );
  for (const result of results) {
    if (
      !result ||
      Array.isArray(result) ||
      typeof result !== "object" ||
      Object.getPrototypeOf(result) !== Object.prototype ||
      typeof result.criterion_id !== "string" ||
      typeof result.outcome !== "string"
    ) {
      fail(
        "criterion_result_invalid",
        "Criterion Result must contain its exact outcome fields",
      );
    }
    if (
      !["clear", "triggered", "not_applicable", "error"].includes(
        result.outcome,
      )
    ) {
      fail(
        "criterion_result_outcome_unsupported",
        "Criterion Result outcome is not supported by this Review Run",
      );
    }
    const errorIsComplete =
      result.error &&
      !Array.isArray(result.error) &&
      typeof result.error === "object" &&
      Object.getPrototypeOf(result.error) === Object.prototype &&
      Object.keys(result.error).length === 2 &&
      typeof result.error.code === "string" &&
      /^[a-z][a-z0-9_]*$/.test(result.error.code) &&
      typeof result.error.detail === "string" &&
      result.error.detail.trim().length > 0;
    if (
      !(
        (["clear", "not_applicable"].includes(result.outcome) &&
          Object.keys(result).length === 2 &&
          result.findings === undefined &&
          result.error === undefined) ||
        (result.outcome === "triggered" &&
          Object.keys(result).length === 3 &&
          Array.isArray(result.findings) &&
          result.findings.length > 0 &&
          result.error === undefined) ||
        (result.outcome === "error" &&
          Object.keys(result).length === 3 &&
          result.findings === undefined &&
          errorIsComplete)
      )
    ) {
      fail(
        "criterion_result_invalid",
        "Criterion Result must contain its exact outcome fields",
      );
    }
    if (result.outcome === "triggered") {
      for (const finding of result.findings) {
        validateFinding(finding, fileChanges);
      }
    }
  }
  const submittedIds = results.map(
    ({ criterion_id: criterionId }) => /** @type {string} */ (criterionId),
  );
  if (
    submittedIds.length !== criterionIds.length ||
    new Set(submittedIds).size !== submittedIds.length ||
    submittedIds.some((id, index) => id !== criterionIds[index])
  ) {
    fail(
      "criterion_result_coverage_invalid",
      "Criterion Results must cover every frozen Criterion exactly once and in order",
    );
  }
  return results.map(
    ({ criterion_id: criterionId, error, findings, outcome }) => ({
      criterion_id: criterionId,
      ...(error === undefined ? {} : { error }),
      ...(findings === undefined ? {} : { findings }),
      outcome,
    }),
  );
}

/** @param {any} finding @param {any[]} fileChanges */
function validateFinding(finding, fileChanges) {
  if (
    !finding ||
    Array.isArray(finding) ||
    typeof finding !== "object" ||
    Object.getPrototypeOf(finding) !== Object.prototype ||
    Object.keys(finding).length !== 3 ||
    typeof finding.evidence !== "string" ||
    finding.evidence.trim().length === 0 ||
    typeof finding.remediation !== "string" ||
    finding.remediation.trim().length === 0 ||
    !finding.location ||
    Array.isArray(finding.location) ||
    typeof finding.location !== "object" ||
    Object.getPrototypeOf(finding.location) !== Object.prototype
  ) {
    fail(
      "finding_invalid",
      "Finding must contain only nonblank evidence, remediation, and one location",
    );
  }
  const location = finding.location;
  if (location.kind === "changeset") {
    if (Object.keys(location).length !== 1) {
      fail(
        "finding_location_invalid",
        "Changeset Finding Location must not contain a File Change or lines",
      );
    }
    return;
  }
  if (
    typeof location.file_change_id !== "string" ||
    !["base", "head"].includes(location.side)
  ) {
    fail(
      "finding_location_invalid",
      "File Finding Location must select one frozen File Change side",
    );
  }
  const fileChange = fileChanges.find(
    ({ id }) => id === location.file_change_id,
  );
  if (!fileChange) {
    fail(
      "finding_location_file_change_invalid",
      "Finding Location must reference a frozen File Change",
    );
  }
  const lineCountForSide =
    location.side === "base"
      ? fileChange.base_line_count
      : fileChange.head_line_count;
  const pathForSide =
    location.side === "base" ? fileChange.before_path : fileChange.after_path;
  if (pathForSide === null) {
    fail(
      "finding_location_side_invalid",
      "Finding Location must reference an existing File Change side",
    );
  }
  if (location.kind === "whole_side") {
    if (Object.keys(location).length !== 3) {
      fail(
        "finding_location_invalid",
        "Whole-side Finding Location must omit line coordinates",
      );
    }
    return;
  }
  if (
    location.kind !== "line_range" ||
    Object.keys(location).length !== 5 ||
    !Number.isSafeInteger(location.start_line) ||
    !Number.isSafeInteger(location.end_line) ||
    location.start_line < 1 ||
    location.end_line < location.start_line ||
    lineCountForSide === null ||
    location.end_line > lineCountForSide
  ) {
    fail(
      "finding_location_line_range_invalid",
      "Finding line range must use inclusive coordinates on a textual frozen File Change side",
    );
  }
}

export { createReviewRunResultService } from "./review-run-result-service.js";
