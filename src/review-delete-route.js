import { writeBrowserJsonMutation } from "./api-mutation.js";
import { isUnavailableError } from "./http-request.js";

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 * @param {{
 *   browserOrigin: string,
 *   browserSessions: ReturnType<typeof import("./browser-session.js").createBrowserSessionService>,
 *   reviews: Pick<ReturnType<typeof import("./review.js").createReviewService>, "list" | "remove">,
 *   encodedReviewId: string,
 *   requestUrl: URL
 * }} options
 */
export async function writeReviewDeletion(
  request,
  response,
  { browserOrigin, browserSessions, reviews, encodedReviewId, requestUrl },
) {
  /** @type {string | undefined} */
  let reviewId;
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
    browserOrigin,
    browserSessions,
    failureCode: "review_deletion_failed",
    failureDetails: (code) =>
      conflictCodes.has(code) && reviewId
        ? { current: currentReview() }
        : undefined,
    mutate: (body) => {
      try {
        reviewId = decodeURIComponent(encodedReviewId);
      } catch {
        throw Object.assign(new Error("request_malformed"), {
          code: "request_malformed",
        });
      }
      reviews.remove(reviewId, body);
      return null;
    },
    requestUrl,
    statusFor: (code, error) =>
      code === "request_malformed" ||
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
