import { requireCodedError } from "../coded-error.ts";
import { isUnavailableError } from "../http-request.ts";
import { writeError, writeJson } from "../http-response.ts";

export function writeReviewList(
  response: import("fastify").FastifyReply,
  reviews: ReturnType<typeof import("./review.ts").createReviewService>,
  state: string | undefined,
) {
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
