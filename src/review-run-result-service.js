import { randomUUID } from "node:crypto";

import { createReviewRunFailureService } from "./review-run-failure.js";
import {
  ReviewRunExecutionError,
  validateReviewRunSubmission,
} from "./review-run-result.js";

/** @param {string} code @param {string} message @returns {never} */
function fail(code, message) {
  throw new ReviewRunExecutionError(code, message);
}

/** @param {any} transaction @param {any} claim @param {number} observedAt */
function readAuthoritativeRun(transaction, claim, observedAt) {
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
    run.lease_expires_at <= observedAt
  ) {
    fail(
      "submission_channel_closed",
      "Review Run submission channel is closed",
    );
  }
  return run;
}

/** @param {any} transaction @param {any} run */
function readCriteria(transaction, run) {
  return transaction
    .all(
      `SELECT criterion_id, impact
       FROM review_version_criteria
       WHERE review_version_id = ?
       ORDER BY position`,
      run.review_version_id,
    )
    .map((/** @type {any} */ row) => {
      if (
        typeof row?.criterion_id !== "string" ||
        !["advisory", "blocking"].includes(String(row.impact))
      ) {
        throw new TypeError("Frozen Review Criterion is invalid");
      }
      return { criterion_id: row.criterion_id, impact: String(row.impact) };
    });
}

/** @param {any} transaction @param {any} run */
function assertSupportedSelection(transaction, run) {
  if (
    transaction.get(
      "SELECT count(*) AS count FROM review_runs WHERE evaluation_id = ?",
      run.evaluation_id,
    )?.count !== 1
  ) {
    fail(
      "review_run_selection_unsupported",
      "Only one selected Review Run is supported",
    );
  }
}

/** @param {any} transaction @param {any} run @param {any} submission */
function storeResultFacts(transaction, run, submission) {
  for (const fileChange of submission.fileChanges) {
    transaction.run(
      `INSERT INTO evaluation_file_changes (
         evaluation_id, id, before_path, after_path,
         base_line_count, head_line_count, patch
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      run.evaluation_id,
      fileChange.id,
      fileChange.before_path,
      fileChange.after_path,
      fileChange.base_line_count,
      fileChange.head_line_count,
      fileChange.patch,
    );
  }
  for (const result of submission.results) {
    transaction.run(
      `INSERT INTO criterion_results (
         review_run_id, criterion_id, outcome, error_code, error_detail
       ) VALUES (?, ?, ?, ?, ?)`,
      submission.workId,
      result.criterion_id,
      result.outcome,
      result.error?.code ?? null,
      result.error?.detail ?? null,
    );
    for (const finding of result.findings ?? []) {
      const location = finding.location;
      transaction.run(
        `INSERT INTO findings (
           id, evaluation_id, review_run_id, criterion_id,
           evidence, remediation, location_kind, file_change_id,
           side, start_line, end_line
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        submission.createFindingId(),
        run.evaluation_id,
        submission.workId,
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
}

/** @param {any} transaction @param {string} evaluationId @param {any[]} criteria @param {any[]} results */
function resultOutcome(transaction, evaluationId, criteria, results) {
  const triggeredImpacts = results
    .filter((/** @type {any} */ result) => result.outcome === "triggered")
    .map(
      (/** @type {any} */ result) =>
        criteria.find(
          (/** @type {any} */ criterion) =>
            criterion.criterion_id === result.criterion_id,
        )?.impact,
    );
  const applicabilityFailed =
    transaction.get(
      `SELECT count(*) AS count
       FROM applicability_results
       WHERE evaluation_id = ? AND outcome = 'error'`,
      evaluationId,
    )?.count !== 0;
  return applicabilityFailed ||
    results.some((/** @type {any} */ result) => result.outcome === "error")
    ? "error"
    : triggeredImpacts.includes("blocking")
      ? "blocking"
      : triggeredImpacts.includes("advisory")
        ? "advisory"
        : "clear";
}

/** @param {any} durableCore @param {{createFindingId?: () => string, now?: () => number}} [options] */
export function createReviewRunResultService(
  durableCore,
  { createFindingId = randomUUID, now = () => Date.now() } = {},
) {
  const service = {
    fail: createReviewRunFailureService(durableCore, now, fail),
    /** @param {any} claim @param {unknown} candidate @param {any[]} fileChanges */
    prepare(claim, candidate, fileChanges) {
      if (!Array.isArray(fileChanges)) {
        throw new TypeError("Frozen File Changes are required");
      }
      const checkedAt = now();
      if (!Number.isSafeInteger(checkedAt) || checkedAt < 0) {
        throw new TypeError("Review Run submission time is invalid");
      }
      return durableCore.transaction((/** @type {any} */ transaction) => {
        const run = readAuthoritativeRun(transaction, claim, checkedAt);
        const criteria = readCriteria(transaction, run);
        assertSupportedSelection(transaction, run);
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
        const frozenFileChanges = fileChanges.map((fileChange) => {
          if (typeof fileChange.patch !== "string") {
            throw new TypeError("Frozen File Change patch is invalid");
          }
          return { ...fileChange };
        });
        const submission = {
          criteria,
          evaluationId: run.evaluation_id,
          fileChanges: frozenFileChanges,
          results,
          reviewVersionId: run.review_version_id,
        };
        const acceptedAt = now();
        if (
          !Number.isSafeInteger(acceptedAt) ||
          acceptedAt < checkedAt ||
          run.lease_expires_at <= acceptedAt
        ) {
          fail(
            "submission_channel_closed",
            "Review Run submission channel is closed",
          );
        }
        storeResultFacts(transaction, run, {
          ...submission,
          createFindingId,
          workId: claim.workId,
        });
        if (
          transaction.run(
            `UPDATE review_runs
             SET execution_status = 'completed', completed_at = ?
             WHERE id = ? AND execution_status = 'running'
               AND completed_at IS NULL`,
            acceptedAt,
            claim.workId,
          ).changes !== 1
        ) {
          fail(
            "submission_channel_closed",
            "Review Run submission channel is closed",
          );
        }
        const outcome = resultOutcome(
          transaction,
          run.evaluation_id,
          submission.criteria,
          submission.results,
        );
        transaction.run(
          `INSERT INTO evaluation_results (
             evaluation_id, outcome, completed_at
           ) VALUES (?, ?, ?)`,
          run.evaluation_id,
          outcome,
          acceptedAt,
        );
        transaction.run(
          `UPDATE evaluations
           SET execution_status = 'completed', completed_at = ?
           WHERE id = ? AND execution_status IN ('queued', 'running')`,
          acceptedAt,
          run.evaluation_id,
        );
      });
    },
  };
  return service;
}
