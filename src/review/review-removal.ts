import { fail, validateDeletionRequest } from "./review-validation.ts";

export type ReviewRemovalCore = {
  transaction<Result>(
    callback: (transaction: {
      get(
        sql: string,
        ...parameters: import("node:sqlite").SQLInputValue[]
      ): Record<string, import("node:sqlite").SQLInputValue> | undefined;
      run(
        sql: string,
        ...parameters: import("node:sqlite").SQLInputValue[]
      ): import("node:sqlite").StatementResultingChanges;
    }) => Result,
  ): Result;
};

export function removeNeverUsedReview(
  durableCore: ReviewRemovalCore,
  reviewId: string,
  request: unknown,
) {
  validateDeletionRequest(request);
  durableCore.transaction((transaction) => {
    if (
      !transaction.get(
        "SELECT 1 AS present FROM reviews WHERE id = ?",
        reviewId,
      )
    ) {
      fail("review_not_found", "Review was not found");
    }
    const used = transaction.get(
      `SELECT 1 AS used
       FROM review_runs
       JOIN review_versions
         ON review_versions.id = review_runs.review_version_id
       WHERE review_versions.review_id = ?
       LIMIT 1`,
      reviewId,
    );
    if (used) {
      fail("review_delete_unsupported", "A used Review must be archived");
    }
    const authorized = transaction.run(
      `UPDATE reviews
       SET hard_delete_pending = 1
       WHERE id = ? AND hard_delete_pending = 0
         AND NOT EXISTS (
           SELECT 1
           FROM review_runs
           JOIN review_versions
             ON review_versions.id = review_runs.review_version_id
           WHERE review_versions.review_id = reviews.id
         )`,
      reviewId,
    );
    if (authorized.changes !== 1) {
      fail("review_deletion_conflict", "Review changed during deletion");
    }
    if (
      transaction.get("SELECT 1 AS present FROM reviews WHERE id = ?", reviewId)
    ) {
      throw new Error("review_deletion_failed");
    }
  });
}
