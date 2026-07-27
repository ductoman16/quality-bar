import { fail } from "./review-validation.js";

/**
 * @param {{get(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): unknown}} transaction
 * @param {unknown} repositoryId
 */
export function requireEvaluationRepository(transaction, repositoryId) {
  if (typeof repositoryId !== "string" || repositoryId.length === 0) {
    throw new TypeError("repositoryId must be a nonempty string");
  }
  if (
    !transaction.get("SELECT id FROM repositories WHERE id = ?", repositoryId)
  ) {
    fail(
      "review_assignment_repository_not_found",
      "Review Assignment Repository was not found",
    );
  }
}

/**
 * @param {{get(sql: string, ...parameters: import("node:sqlite").SQLInputValue[]): unknown}} transaction
 * @param {Parameters<typeof selectReviewVersionsForNewEvaluation>[0]} reviews
 * @param {string} repositoryId
 */
export function selectReviewVersionsForRegisteredRepository(
  transaction,
  reviews,
  repositoryId,
) {
  requireEvaluationRepository(transaction, repositoryId);
  return selectReviewVersionsForNewEvaluation(reviews, repositoryId);
}

/**
 * @param {Array<{
 *   id: string,
 *   archived: boolean,
 *   assignment: {scope: string, repository_ids?: string[]},
 *   active_version: {id: string}
 * }>} reviews
 * @param {string} repositoryId
 */
export function selectReviewVersionsForNewEvaluation(reviews, repositoryId) {
  if (typeof repositoryId !== "string" || repositoryId.length === 0) {
    throw new TypeError("repositoryId must be a nonempty string");
  }
  if (
    !Array.isArray(reviews) ||
    reviews.some(
      (review) =>
        !review ||
        typeof review.id !== "string" ||
        typeof review.archived !== "boolean" ||
        !review.active_version ||
        typeof review.active_version.id !== "string" ||
        !review.assignment ||
        !(
          (review.assignment.scope === "installation_wide" &&
            !("repository_ids" in review.assignment)) ||
          (review.assignment.scope === "repository_set" &&
            Array.isArray(review.assignment.repository_ids) &&
            review.assignment.repository_ids.length > 0 &&
            review.assignment.repository_ids.every(
              (id) => typeof id === "string" && id.length > 0,
            ) &&
            new Set(review.assignment.repository_ids).size ===
              review.assignment.repository_ids.length)
        ),
    )
  ) {
    throw new TypeError("reviews must contain complete Review selections");
  }
  return reviews
    .filter(
      ({ archived, assignment }) =>
        !archived &&
        (assignment.scope === "installation_wide" ||
          assignment.repository_ids?.includes(repositoryId) === true),
    )
    .map((review) => ({
      review_id: review.id,
      review_version_id: review.active_version.id,
    }));
}
