/**
 * @param {Array<{
 *   id: string,
 *   archived: boolean,
 *   active_version: {id: string}
 * }>} reviews
 */
export function selectReviewVersionsForNewEvaluation(reviews) {
  if (
    !Array.isArray(reviews) ||
    reviews.some(
      (review) =>
        !review ||
        typeof review.id !== "string" ||
        typeof review.archived !== "boolean" ||
        !review.active_version ||
        typeof review.active_version.id !== "string",
    )
  ) {
    throw new TypeError("reviews must contain complete Review selections");
  }
  return reviews
    .filter(({ archived }) => !archived)
    .map((review) => ({
      review_id: review.id,
      review_version_id: review.active_version.id,
    }));
}
