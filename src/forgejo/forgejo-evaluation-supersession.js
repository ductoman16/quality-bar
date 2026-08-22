import {
  cancelEvaluationInTransaction,
  SUPERSESSION_CANCELLATION,
} from "../evaluation/evaluation-cancellation.js";

/**
 * @param {any} transaction
 * @param {{baseCommit: string, headCommit: string, pullRequestNumber: number, repositoryId: string}} input
 * @param {() => number} now
 * @param {(code: string, detail: string) => never} fail
 */
export function cancelSupersededForgejoEvaluations(
  transaction,
  { baseCommit, headCommit, pullRequestNumber, repositoryId },
  now,
  fail,
) {
  // Supersession is scoped to the observed PR; a shared pair is still that PR's older work.
  const superseded = transaction.all(
    `SELECT evaluations.id
       FROM forgejo_automatic_evaluation_pull_requests
       JOIN evaluations
         ON evaluations.id =
            forgejo_automatic_evaluation_pull_requests.evaluation_id
      WHERE forgejo_automatic_evaluation_pull_requests.repository_id = ?
        AND forgejo_automatic_evaluation_pull_requests.pull_request_number = ?
        AND (
          forgejo_automatic_evaluation_pull_requests.base_commit <> ?
          OR forgejo_automatic_evaluation_pull_requests.head_commit <> ?
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
