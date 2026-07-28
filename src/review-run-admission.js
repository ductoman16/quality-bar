import { failEvaluation } from "./evaluation-validation.js";

export const REVIEW_RUN_QUEUE_CAPACITY = 25;

/**
 * @typedef {{
 *   all(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): (Record<string, import("node:sqlite").SQLInputValue> | undefined)[],
 *   get(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): Record<string, import("node:sqlite").SQLInputValue> | undefined,
 *   run(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): import("node:sqlite").StatementResultingChanges
 * }} AdmissionTransaction
 */

/**
 * @param {number} queuedCount
 * @param {number} requestedCount
 */
export function assertReviewRunCapacity(queuedCount, requestedCount) {
  if (
    !Number.isSafeInteger(queuedCount) ||
    queuedCount < 0 ||
    !Number.isSafeInteger(requestedCount) ||
    requestedCount < 0
  ) {
    throw new TypeError("Review Run capacity counts are invalid");
  }
  if (queuedCount + requestedCount > REVIEW_RUN_QUEUE_CAPACITY) {
    failEvaluation(
      "capacity_unavailable",
      "Codex execution capacity is unavailable",
    );
  }
}

/**
 * @param {AdmissionTransaction} transaction
 * @param {string} repositoryId
 * @param {() => string} createReviewRunId
 * @param {() => (Error & {code: string}) | null} readCodexCapabilityFailure
 */
export function selectReviewRunsForAdmission(
  transaction,
  repositoryId,
  createReviewRunId,
  readCodexCapabilityFailure,
) {
  const selectedReviews = transaction.all(
    `SELECT reviews.id AS review_id, reviews.active_version_id
     FROM reviews
     JOIN review_assignments ON review_assignments.review_id = reviews.id
     WHERE reviews.archived_at IS NULL
       AND (
         review_assignments.scope = 'installation_wide'
         OR EXISTS (
           SELECT 1 FROM review_assignment_repositories
           WHERE review_assignment_repositories.review_id = reviews.id
             AND review_assignment_repositories.repository_id = ?
         )
       )
     ORDER BY reviews.id`,
    repositoryId,
  );
  if (selectedReviews.length > 0) {
    const capabilityFailure = readCodexCapabilityFailure();
    if (capabilityFailure) {
      throw capabilityFailure;
    }
  }
  const queuedCount = transaction.get(
    `SELECT count(*) AS count
     FROM codex_execution_queue
     WHERE started_at IS NULL`,
  )?.count;
  assertReviewRunCapacity(
    /** @type {number} */ (queuedCount),
    selectedReviews.length,
  );
  return selectedReviews.map((selectedReview) => {
    const id = createReviewRunId();
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      typeof selectedReview?.review_id !== "string" ||
      typeof selectedReview.active_version_id !== "string"
    ) {
      throw new TypeError("Review Run identity is invalid");
    }
    return {
      id,
      reviewId: selectedReview.review_id,
      reviewVersionId: selectedReview.active_version_id,
    };
  });
}

/**
 * @param {AdmissionTransaction} transaction
 * @param {string} evaluationId
 * @param {{id: string, reviewId: string, reviewVersionId: string}[]} reviewRuns
 * @param {number} createdAt
 */
export function enqueueReviewRuns(
  transaction,
  evaluationId,
  reviewRuns,
  createdAt,
) {
  for (const reviewRun of reviewRuns) {
    transaction.run(
      `INSERT INTO review_runs (
         id, evaluation_id, review_id, review_version_id,
         execution_status, created_at
       ) VALUES (?, ?, ?, ?, 'queued', ?)`,
      reviewRun.id,
      evaluationId,
      reviewRun.reviewId,
      reviewRun.reviewVersionId,
      createdAt,
    );
    transaction.run(
      `INSERT INTO codex_execution_queue (
         work_id, work_kind, ready_at, accepted_at, started_at
       ) VALUES (?, 'review_run', ?, ?, NULL)`,
      reviewRun.id,
      createdAt,
      createdAt,
    );
  }
}
