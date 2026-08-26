import { fail } from "./review-validation.ts";

export function requireEvaluationRepository(
  transaction: {
    get(
      sql: string,
      ...parameters: import("node:sqlite").SQLInputValue[]
    ): unknown;
  },
  repositoryId: unknown,
) {
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

export function selectReviewVersionsForRegisteredRepository(
  transaction: {
    get(
      sql: string,
      ...parameters: import("node:sqlite").SQLInputValue[]
    ): unknown;
  },
  reviews: Parameters<typeof selectReviewVersionsForNewEvaluation>[0],
  repositoryId: string,
) {
  requireEvaluationRepository(transaction, repositoryId);
  return selectReviewVersionsForNewEvaluation(reviews, repositoryId);
}

export function selectReviewVersionsForNewEvaluation(
  reviews: Array<{
    id: string;
    archived: boolean;
    assignment: { scope: string; repository_ids?: string[] };
    active_version: { id: string };
  }>,
  repositoryId: string,
) {
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
