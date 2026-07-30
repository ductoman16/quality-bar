import { requireCodedError } from "./coded-error.js";
import { isUnavailableError } from "./http-request.js";
import { writeError, writeJson } from "./http-response.js";

/**
 * @param {import("node:http").ServerResponse} response
 * @param {{read: () => unknown}} analytics
 */
export function writeAnalytics(response, analytics) {
  try {
    writeJson(response, 200, analytics.read());
  } catch (error) {
    const failure = requireCodedError(error);
    writeError(
      response,
      isUnavailableError(failure) ? 503 : 500,
      failure.code,
      failure.message,
    );
  }
}
