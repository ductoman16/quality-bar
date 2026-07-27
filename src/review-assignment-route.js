import { writeBrowserJsonMutation } from "./api-mutation.js";
import { isUnavailableError } from "./http-request.js";

/** @param {string} path */
export function reviewAssignmentPathIdentity(path) {
  return path.match(/^\/api\/v1\/reviews\/([^/]+)\/assignment$/)?.[1] ?? null;
}

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 * @param {{
 *   browserOrigin: string,
 *   browserSessions: ReturnType<typeof import("./browser-session.js").createBrowserSessionService>,
 *   requestUrl: URL,
 *   reviewId: string,
 *   reviews: ReturnType<typeof import("./review.js").createReviewService>
 * }} dependencies
 */
export async function writeReviewAssignmentMutation(
  request,
  response,
  { browserOrigin, browserSessions, requestUrl, reviewId, reviews },
) {
  await writeBrowserJsonMutation(request, response, {
    browserOrigin,
    browserSessions,
    failureCode: "review_assignment_change_failed",
    mutate: (body) => reviews.setAssignment(decodeURIComponent(reviewId), body),
    requestUrl,
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
