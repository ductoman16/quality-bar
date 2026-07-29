import { evaluateApplicabilityRule } from "./applicability-evaluation.js";
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
 * @param {{file_changes?: unknown}} changeset
 * @param {(pathspec: string, path: string) => boolean} matchesPath
 */
export function selectReviewRunsForAdmission(
  transaction,
  repositoryId,
  createReviewRunId,
  readCodexCapabilityFailure,
  changeset,
  matchesPath,
) {
  const selectedReviews = transaction.all(
    `SELECT reviews.id AS review_id, reviews.active_version_id,
            CASE review_assignments.scope
              WHEN 'repository_set' THEN 'repository_specific'
              ELSE review_assignments.scope
            END AS scope,
            review_versions.applicability_rule
     FROM reviews
     JOIN review_assignments ON review_assignments.review_id = reviews.id
     JOIN review_versions
       ON review_versions.id = reviews.active_version_id
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
  const applicabilityResults = selectedReviews.map((selectedReview) => {
    const reviewId = selectedReview?.review_id;
    const reviewVersionId = selectedReview?.active_version_id;
    const scope = selectedReview?.scope;
    const rule = selectedReview?.applicability_rule;
    if (
      typeof reviewId !== "string" ||
      typeof reviewVersionId !== "string" ||
      !["installation_wide", "repository_specific"].includes(String(scope)) ||
      !(rule === null || typeof rule === "string")
    ) {
      throw new TypeError("Assigned Review Version is invalid");
    }
    const evaluated =
      rule === null
        ? {
            evidence: { kind: "unconditional" },
            outcome: "applicable",
            profile: null,
            source: null,
          }
        : evaluateApplicabilityRule(rule, changeset, { matchesPath });
    return {
      assignmentScope: /** @type {string} */ (scope),
      ...evaluated,
      reviewId,
      reviewVersionId,
    };
  });
  const applicableResults = applicabilityResults.filter(
    ({ outcome }) => outcome === "applicable",
  );
  if (applicableResults.length > 0) {
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
    applicableResults.length,
  );
  const reviewRuns = applicableResults.map((selectedReview) => {
    const id = createReviewRunId();
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      typeof selectedReview.reviewId !== "string" ||
      typeof selectedReview.reviewVersionId !== "string"
    ) {
      throw new TypeError("Review Run identity is invalid");
    }
    return {
      id,
      reviewId: selectedReview.reviewId,
      reviewVersionId: selectedReview.reviewVersionId,
    };
  });
  return { applicabilityResults, reviewRuns };
}

/**
 * @param {AdmissionTransaction} transaction
 * @param {string} evaluationId
 * @param {ReturnType<typeof selectReviewRunsForAdmission>["applicabilityResults"]} results
 */
export function insertApplicabilityResults(transaction, evaluationId, results) {
  for (const resultValue of results) {
    const result = /** @type {any} */ (resultValue);
    transaction.run(
      `INSERT INTO applicability_selections (
         evaluation_id, review_id, review_version_id, assignment_scope,
         profile, rule_source
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      evaluationId,
      result.reviewId,
      result.reviewVersionId,
      result.assignmentScope,
      result.profile,
      result.source,
    );
    transaction.run(
      `INSERT INTO applicability_results (
         evaluation_id, review_id, review_version_id, assignment_scope,
         profile, rule_source, outcome, evidence_json, error_code, error_detail,
         error_context_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      evaluationId,
      result.reviewId,
      result.reviewVersionId,
      result.assignmentScope,
      result.profile,
      result.source,
      result.outcome,
      result.evidence === undefined ? null : JSON.stringify(result.evidence),
      result.error?.code ?? null,
      result.error?.detail ?? null,
      result.error === undefined ? null : JSON.stringify(result.error),
    );
  }
}

/**
 * @param {AdmissionTransaction} transaction
 * @param {string} evaluationId
 * @param {number} sealedAt
 */
export function sealApplicabilityResults(transaction, evaluationId, sealedAt) {
  const sealed = transaction.run(
    `UPDATE evaluations
     SET applicability_sealed_at = ?
     WHERE id = ? AND applicability_sealed_at IS NULL`,
    sealedAt,
    evaluationId,
  );
  if (sealed.changes !== 1) {
    throw new TypeError("Applicability Result authority could not be sealed");
  }
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
