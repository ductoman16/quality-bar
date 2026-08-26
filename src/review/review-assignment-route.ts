import { writeBrowserJsonMutation } from "../api-mutation.ts";
import { isUnavailableError } from "../http-request.ts";

export async function writeReviewAssignmentMutation(
  request: import("fastify").FastifyRequest,
  response: import("fastify").FastifyReply,
  {
    reviewId,
    reviews,
  }: {
    reviewId: string;
    reviews: ReturnType<typeof import("./review.ts").createReviewService>;
  },
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
