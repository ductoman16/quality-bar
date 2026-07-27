import { requireCodedError } from "./coded-error.js";
import { isUnavailableError } from "./http-request.js";
import { writeError, writeJson } from "./http-response.js";

/**
 * @param {import("node:http").ServerResponse} response
 * @param {ReturnType<typeof import("./review.js").createReviewService>} reviews
 * @param {string | undefined} state
 */
export function writeReviewList(response, reviews, state) {
  try {
    writeJson(response, 200, { reviews: reviews.list(state) });
  } catch (error) {
    if (error instanceof Error && !("code" in error)) {
      writeError(response, 500, "review_list_failed", error.message);
      return;
    }
    const failure = requireCodedError(error);
    const invalidState = failure.code === "review_list_state_invalid";
    writeError(
      response,
      invalidState ? 400 : isUnavailableError(error) ? 503 : 500,
      invalidState
        ? failure.code
        : isUnavailableError(error)
          ? failure.code
          : "review_list_failed",
      failure.message,
    );
  }
}
