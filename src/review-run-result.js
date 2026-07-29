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
 * @param {(string | {criterion_id: string, impact: string})[]} criteria
 * @param {{id: string, before_path: string | null, after_path: string | null, base_line_count: number | null, head_line_count: number | null}[]} [fileChanges]
 */
export function validateReviewRunSubmission(
  candidate,
  criteria,
  fileChanges = [],
) {
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
  const criterionIds = criteria.map((criterion) =>
    typeof criterion === "string" ? criterion : criterion.criterion_id,
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
    if (!["clear", "triggered"].includes(result.outcome)) {
      fail(
        "criterion_result_outcome_unsupported",
        "Only clear and triggered Criterion Results are supported by this Review Run",
      );
    }
    if (
      !(
        (result.outcome === "clear" &&
          Object.keys(result).length === 2 &&
          result.findings === undefined) ||
        (result.outcome === "triggered" &&
          Object.keys(result).length === 3 &&
          Array.isArray(result.findings) &&
          result.findings.length > 0)
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
  return results.map(({ criterion_id: criterionId, findings, outcome }) => ({
    criterion_id: criterionId,
    ...(findings === undefined ? {} : { findings }),
    outcome,
  }));
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

/**
 * @param {{
 *   all(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): (Record<string, import("node:sqlite").SQLInputValue> | undefined)[],
 *   get(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): Record<string, import("node:sqlite").SQLInputValue> | undefined,
 *   transaction<Result>(callback: (transaction: {
 *     all(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): (Record<string, import("node:sqlite").SQLInputValue> | undefined)[],
 *     get(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): Record<string, import("node:sqlite").SQLInputValue> | undefined,
 *     run(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): import("node:sqlite").StatementResultingChanges
 *   }) => Result): Result
 * }} durableCore
 * @param {{createFindingId?: () => string, now?: () => number}} [options]
 */
export function createReviewRunResultService(
  durableCore,
  { createFindingId = randomUUID, now = () => Date.now() } = {},
) {
  return {
    /**
     * @param {{fencingToken: number, workerId: string, workId: string}} claim
     * @param {unknown} candidate
     * @param {{id: string, before_path: string | null, after_path: string | null, base_line_count: number | null, head_line_count: number | null}[]} [fileChanges]
     */
    submit(claim, candidate, fileChanges = []) {
      const completedAt = now();
      if (!Number.isSafeInteger(completedAt) || completedAt < 0) {
        throw new TypeError("Review Run completion time is invalid");
      }
      return durableCore.transaction((transaction) => {
        const run = transaction.get(
          `SELECT review_runs.evaluation_id, review_runs.review_version_id,
                  review_runs.execution_status,
                  codex_execution_queue.worker_id,
                  codex_execution_queue.fencing_token,
                  codex_execution_queue.lease_expires_at
           FROM review_runs
           JOIN codex_execution_queue
             ON codex_execution_queue.work_id = review_runs.id
           WHERE review_runs.id = ?`,
          claim.workId,
        );
        if (
          !run ||
          run.execution_status !== "running" ||
          run.worker_id !== claim.workerId ||
          run.fencing_token !== claim.fencingToken ||
          typeof run.lease_expires_at !== "number" ||
          run.lease_expires_at <= completedAt
        ) {
          fail(
            "submission_channel_closed",
            "Review Run submission channel is closed",
          );
        }
        const criteria = transaction
          .all(
            `SELECT criterion_id, impact
             FROM review_version_criteria
             WHERE review_version_id = ?
             ORDER BY position`,
            run.review_version_id,
          )
          .map((row) => {
            if (typeof row?.criterion_id !== "string") {
              throw new TypeError("Frozen Review Criterion is invalid");
            }
            if (!["advisory", "blocking"].includes(String(row.impact))) {
              throw new TypeError("Frozen Review Criterion is invalid");
            }
            return {
              criterion_id: row.criterion_id,
              impact: /** @type {string} */ (row.impact),
            };
          });
        if (
          transaction.get(
            `SELECT count(*) AS count
             FROM review_runs WHERE evaluation_id = ?`,
            run.evaluation_id,
          )?.count !== 1
        ) {
          fail(
            "review_run_selection_unsupported",
            "Only one selected Review Run is supported",
          );
        }
        const results = validateReviewRunSubmission(
          candidate,
          criteria,
          fileChanges,
        );
        if (
          new Set(fileChanges.map(({ id }) => id)).size !== fileChanges.length
        ) {
          throw new TypeError("Frozen File Change identity is invalid");
        }
        for (const fileChange of fileChanges) {
          transaction.run(
            `INSERT INTO evaluation_file_changes (
               evaluation_id, id, before_path, after_path,
               base_line_count, head_line_count
             ) VALUES (?, ?, ?, ?, ?, ?)`,
            run.evaluation_id,
            fileChange.id,
            fileChange.before_path,
            fileChange.after_path,
            fileChange.base_line_count,
            fileChange.head_line_count,
          );
        }
        for (const result of results) {
          transaction.run(
            `INSERT INTO criterion_results (
               review_run_id, criterion_id, outcome
             ) VALUES (?, ?, ?)`,
            claim.workId,
            result.criterion_id,
            result.outcome,
          );
          for (const finding of result.findings ?? []) {
            const location = finding.location;
            transaction.run(
              `INSERT INTO findings (
                 id, evaluation_id, review_run_id, criterion_id,
                 evidence, remediation, location_kind, file_change_id,
                 side, start_line, end_line
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              createFindingId(),
              run.evaluation_id,
              claim.workId,
              result.criterion_id,
              finding.evidence,
              finding.remediation,
              location.kind,
              location.file_change_id ?? null,
              location.side ?? null,
              location.start_line ?? null,
              location.end_line ?? null,
            );
          }
        }
        const completed = transaction.run(
          `UPDATE review_runs
           SET execution_status = 'completed', completed_at = ?
           WHERE id = ? AND execution_status = 'running'`,
          completedAt,
          claim.workId,
        );
        if (completed.changes !== 1) {
          fail(
            "submission_channel_closed",
            "Review Run submission channel is closed",
          );
        }
        const evaluationId = /** @type {string} */ (run.evaluation_id);
        const triggeredImpacts = results
          .filter(({ outcome }) => outcome === "triggered")
          .map(
            ({ criterion_id: criterionId }) =>
              criteria.find(
                ({ criterion_id: frozenId }) => frozenId === criterionId,
              )?.impact,
          );
        const outcome = triggeredImpacts.includes("blocking")
          ? "blocking"
          : triggeredImpacts.includes("advisory")
            ? "advisory"
            : "clear";
        transaction.run(
          `INSERT INTO evaluation_results (
             evaluation_id, outcome, completed_at
           ) VALUES (?, ?, ?)`,
          evaluationId,
          outcome,
          completedAt,
        );
        transaction.run(
          `UPDATE evaluations
           SET execution_status = 'completed', completed_at = ?
           WHERE id = ? AND execution_status IN ('queued', 'running')`,
          completedAt,
          evaluationId,
        );
      });
    },
  };
}
import { randomUUID } from "node:crypto";
