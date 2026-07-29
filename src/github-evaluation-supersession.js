import {
  cancelEvaluationInTransaction,
  SUPERSESSION_CANCELLATION,
} from "./evaluation-cancellation.js";
import { EVALUATION_SELECTION, readEvaluation } from "./evaluation-resource.js";

/**
 * @param {any} transaction
 * @param {{
 *   baseCommit: string,
 *   headCommit: string,
 *   pullRequestNumber: number,
 *   repositoryId: string
 * }} input
 * @param {() => number} now
 * @param {(code: string, detail: string) => never} fail
 */
export function cancelSupersededGitHubEvaluations(
  transaction,
  { baseCommit, headCommit, pullRequestNumber, repositoryId },
  now,
  fail,
) {
  const superseded = transaction.all(
    `SELECT evaluations.id
       FROM github_automatic_evaluation_pull_requests
       JOIN evaluations
         ON evaluations.id =
            github_automatic_evaluation_pull_requests.evaluation_id
      WHERE github_automatic_evaluation_pull_requests.repository_id = ?
        AND github_automatic_evaluation_pull_requests.pull_request_number = ?
        AND (
          github_automatic_evaluation_pull_requests.base_commit <> ?
          OR github_automatic_evaluation_pull_requests.head_commit <> ?
        )
        AND evaluations.execution_status IN ('queued', 'running')
      ORDER BY evaluations.created_at, evaluations.id`,
    repositoryId,
    pullRequestNumber,
    baseCommit,
    headCommit,
  );
  if (superseded.length === 0) {
    return [];
  }
  const requestedAt = now();
  if (!Number.isSafeInteger(requestedAt) || requestedAt < 0) {
    throw new TypeError("now must return a nonnegative safe integer timestamp");
  }
  return superseded.flatMap((/** @type {any} */ evaluation) =>
    cancelEvaluationInTransaction(
      transaction,
      /** @type {string} */ (evaluation.id),
      requestedAt,
      SUPERSESSION_CANCELLATION,
      fail,
    ),
  );
}

/**
 * @param {any} transaction
 * @param {string} evaluationId
 * @param {{
 *   changeset: {base_commit: string, head_commit: string},
 *   pullRequestNumber?: number,
 *   repositoryId: string
 * }} input
 */
export function recordGitHubPullRequestEvaluation(
  transaction,
  evaluationId,
  { changeset, pullRequestNumber, repositoryId },
) {
  const existing = transaction.get(
    `SELECT evaluation_id
       FROM github_automatic_evaluation_pull_requests
      WHERE repository_id = ?
        AND pull_request_number = ?
        AND base_commit = ?
        AND head_commit = ?`,
    repositoryId,
    /** @type {number} */ (pullRequestNumber),
    changeset.base_commit,
    changeset.head_commit,
  );
  if (existing) {
    if (existing.evaluation_id !== evaluationId) {
      throw new Error("GitHub pull request Evaluation association conflicts");
    }
    return;
  }
  transaction.run(
    `INSERT INTO github_automatic_evaluation_pull_requests (
       evaluation_id, repository_id, pull_request_number,
       base_commit, head_commit
     ) VALUES (?, ?, ?, ?, ?)`,
    evaluationId,
    repositoryId,
    /** @type {number} */ (pullRequestNumber),
    changeset.base_commit,
    changeset.head_commit,
  );
}

/**
 * @param {any} transaction
 * @param {{
 *   changeset: {base_commit: string, head_commit: string},
 *   pullRequestNumber: number,
 *   repositoryId: string
 * }} input
 * @param {() => number} now
 * @param {(code: string, detail: string) => never} fail
 */
export function prepareGitHubAutomaticEvaluation(
  transaction,
  { changeset, pullRequestNumber, repositoryId },
  now,
  fail,
) {
  if (!Number.isSafeInteger(pullRequestNumber) || pullRequestNumber <= 0) {
    throw new TypeError("Automatic Evaluation provenance is invalid");
  }
  const cancelledRunningReviewRunIds = cancelSupersededGitHubEvaluations(
    transaction,
    {
      baseCommit: changeset.base_commit,
      headCommit: changeset.head_commit,
      pullRequestNumber,
      repositoryId,
    },
    now,
    fail,
  );
  const existing = transaction.get(
    `SELECT evaluation_id FROM github_automatic_evaluations
      WHERE repository_id = ? AND base_commit = ? AND head_commit = ?`,
    repositoryId,
    changeset.base_commit,
    changeset.head_commit,
  );
  if (!existing) {
    return { cancelledRunningReviewRunIds, existing: null };
  }
  recordGitHubPullRequestEvaluation(transaction, existing.evaluation_id, {
    changeset,
    pullRequestNumber,
    repositoryId,
  });
  const row = transaction.get(
    `${EVALUATION_SELECTION} WHERE evaluations.id = ?`,
    existing.evaluation_id,
  );
  return {
    cancelledRunningReviewRunIds,
    existing: {
      createdAt: row.created_at,
      evaluationId: existing.evaluation_id,
      resource: readEvaluation(row),
    },
  };
}
