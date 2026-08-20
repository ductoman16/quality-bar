import { writeBrowserJsonMutation } from "./api-mutation.js";
import { isUnavailableError } from "./http-request.js";

/**
 * @param {import("fastify").FastifyRequest} request
 * @param {import("fastify").FastifyReply} response
 * @param {{
 *   reviewId: string,
 *   reviews: ReturnType<typeof import("./review.js").createReviewService>
 * }} dependencies
 */
export async function writeReviewAssignmentMutation(
  request,
  response,
  { reviewId, reviews },
) {
  await writeBrowserJsonMutation(request, response, {
    failureCode: "review_assignment_change_failed",
    mutate: (body) => reviews.setAssignment(reviewId, body),
    statusFor: (code, error) =>
      ["review_not_found", "review_assignment_repository_not_found"].includes(
        code,
      )
        ? 404
        : code === "review_archived"
          ? 409
          : isUnavailableError(error)
            ? 503
            : 422,
  });
}
