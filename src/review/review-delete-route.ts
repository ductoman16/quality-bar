import { writeBrowserJsonMutation } from "../api-mutation.ts";
import { isUnavailableError } from "../http-request.ts";

export async function writeReviewDeletion(
  request: import("fastify").FastifyRequest,
  response: import("fastify").FastifyReply,
  {
    reviews,
    reviewId,
  }: {
    reviews: Pick<
      ReturnType<typeof import("./review.ts").createReviewService>,
      "list" | "remove"
    >;
    reviewId: string;
  },
) {
  const conflictCodes = new Set([
    "review_delete_unsupported",
    "review_deletion_conflict",
  ]);
  function currentReview() {
    return (
      [...reviews.list(), ...reviews.list("archived")].find(
        (review) => review.id === reviewId,
      ) ?? null
    );
  }
  await writeBrowserJsonMutation(request, response, {
    failureCode: "review_deletion_failed",
    failureDetails: (code) =>
      conflictCodes.has(code) && reviewId
        ? { current: currentReview() }
        : undefined,
    mutate: (body) => {
      reviews.remove(reviewId, body);
      return null;
    },
    statusFor: (code, error) =>
      code === "review_deletion_request_malformed"
        ? 400
        : code === "review_not_found"
          ? 404
          : conflictCodes.has(code)
            ? 409
            : isUnavailableError(error)
              ? 503
              : 422,
  });
}
