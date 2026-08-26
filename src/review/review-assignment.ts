import { readReview } from "./review-read.ts";
import { fail } from "./review-validation.ts";

export type ValidatedReviewAssignment =
  import("./review-validation.ts").ValidatedReviewAssignment;
export type AssignmentTransaction = {
  get(
    sql: string,
    ...parameters: import("node:sqlite").SQLInputValue[]
  ): Record<string, import("node:sqlite").SQLInputValue> | undefined;
  run(
    sql: string,
    ...parameters: import("node:sqlite").SQLInputValue[]
  ): import("node:sqlite").StatementResultingChanges;
};

function requireRepositories(
  transaction: AssignmentTransaction,
  assignment: ValidatedReviewAssignment,
) {
  if (assignment.scope !== "repository_set") {
    return;
  }
  for (const repositoryId of assignment.repository_ids) {
    if (
      !transaction.get("SELECT id FROM repositories WHERE id = ?", repositoryId)
    ) {
      fail(
        "review_assignment_repository_not_found",
        "Review Assignment Repository was not found",
      );
    }
  }
}

function insertRepositoryMemberships(
  transaction: AssignmentTransaction,
  reviewId: string,
  assignment: ValidatedReviewAssignment,
) {
  if (assignment.scope !== "repository_set") {
    return;
  }
  for (const repositoryId of assignment.repository_ids) {
    transaction.run(
      "INSERT INTO review_assignment_repositories (review_id, repository_id) VALUES (?, ?)",
      reviewId,
      repositoryId,
    );
  }
}

export function createReviewAssignment(
  transaction: AssignmentTransaction,
  reviewId: string,
  assignment: ValidatedReviewAssignment,
  createdAt: number,
) {
  requireRepositories(transaction, assignment);
  transaction.run(
    "INSERT INTO review_assignments (review_id, scope, created_at) VALUES (?, ?, ?)",
    reviewId,
    assignment.scope,
    createdAt,
  );
  insertRepositoryMemberships(transaction, reviewId, assignment);
}

export function changeReviewAssignment(
  transaction: AssignmentTransaction & {
    all(
      sql: string,
      ...parameters: import("node:sqlite").SQLInputValue[]
    ): Array<Record<string, import("node:sqlite").SQLInputValue> | undefined>;
  },
  reviewId: string,
  assignment: ValidatedReviewAssignment,
  now: () => number,
) {
  const current = readReview(transaction, reviewId);
  if (current.archived) {
    fail(
      "review_archived",
      "Archived Review cannot change its Review Assignment",
    );
  }
  if (JSON.stringify(current.assignment) === JSON.stringify(assignment)) {
    return { changed: false, review: current };
  }
  requireRepositories(transaction, assignment);
  const changedAt = now();
  if (!Number.isSafeInteger(changedAt)) {
    throw new TypeError("now must return a safe integer timestamp");
  }
  transaction.run(
    "DELETE FROM review_assignment_repositories WHERE review_id = ?",
    reviewId,
  );
  const result = transaction.run(
    "UPDATE review_assignments SET scope = ?, created_at = ? WHERE review_id = ?",
    assignment.scope,
    changedAt,
    reviewId,
  );
  if (result.changes !== 1) {
    throw new Error("review_assignment_change_failed");
  }
  insertRepositoryMemberships(transaction, reviewId, assignment);
  return { changed: true, review: readReview(transaction, reviewId) };
}
