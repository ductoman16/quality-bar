import { EVALUATION_SELECTION, readEvaluation } from "./evaluation-resource.js";
import { cancelSupersededForgejoEvaluations } from "./forgejo-evaluation-supersession.js";

/** @param {any} transaction @param {string} evaluationId @param {{changeset: {base_commit: string, head_commit: string}, pullRequestNumber: number, repositoryId: string}} input */
export function recordForgejoPullRequestEvaluation(
  transaction,
  evaluationId,
  { changeset, pullRequestNumber, repositoryId },
) {
  const existing = transaction.get(
    `SELECT evaluation_id
       FROM forgejo_automatic_evaluation_pull_requests
      WHERE repository_id = ? AND pull_request_number = ?
        AND base_commit = ? AND head_commit = ?`,
    repositoryId,
    pullRequestNumber,
    changeset.base_commit,
    changeset.head_commit,
  );
  if (existing) {
    if (existing.evaluation_id !== evaluationId) {
      throw new Error("Forgejo pull request Evaluation association conflicts");
    }
    return;
  }
  transaction.run(
    `INSERT INTO forgejo_automatic_evaluation_pull_requests (
       evaluation_id, repository_id, pull_request_number,
       base_commit, head_commit
     ) VALUES (?, ?, ?, ?, ?)`,
    evaluationId,
    repositoryId,
    pullRequestNumber,
    changeset.base_commit,
    changeset.head_commit,
  );
}

/** @param {any} transaction @param {{changeset: {base_commit: string, head_commit: string}, pullRequestNumber: number, repositoryId: string}} input @param {() => number} now @param {(code: string, detail: string) => never} fail */
export function prepareForgejoAutomaticEvaluation(
  transaction,
  input,
  now,
  fail,
) {
  if (
    !Number.isSafeInteger(input.pullRequestNumber) ||
    input.pullRequestNumber <= 0
  ) {
    throw new TypeError("Automatic Forgejo Evaluation provenance is invalid");
  }
  const cancelledRunningReviewRunIds = cancelSupersededForgejoEvaluations(
    transaction,
    {
      baseCommit: input.changeset.base_commit,
      headCommit: input.changeset.head_commit,
      pullRequestNumber: input.pullRequestNumber,
      repositoryId: input.repositoryId,
    },
    now,
    fail,
  );
  const existing = transaction.get(
    `SELECT evaluation_id FROM forgejo_automatic_evaluations
      WHERE repository_id = ? AND base_commit = ? AND head_commit = ?`,
    input.repositoryId,
    input.changeset.base_commit,
    input.changeset.head_commit,
  );
  if (!existing) {
    return { cancelledRunningReviewRunIds, existing: null };
  }
  recordForgejoPullRequestEvaluation(
    transaction,
    /** @type {string} */ (existing.evaluation_id),
    input,
  );
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
