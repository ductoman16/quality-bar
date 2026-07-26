import {
  assertAllowedQueryParameters,
  authenticationFailureStatus,
  requireBrowserSession,
} from "./http-request.js";
import { requireCodedError } from "./coded-error.js";
import { writeError, writeJavascript } from "./http-response.js";

/**
 * @param {{
 *   browserAssetReader: (path: string) => string,
 *   browserSessions: ReturnType<typeof import("./browser-session.js").createBrowserSessionService>
 * }} dependencies
 */
export function createBrowserAssetRoute({
  browserAssetReader,
  browserSessions,
}) {
  /**
   * @param {import("node:http").IncomingMessage} request
   * @param {import("node:http").ServerResponse} response
   * @param {URL} requestUrl
   */
  return function handleBrowserAsset(request, response, requestUrl) {
    const path = requestUrl.pathname;
    if (request.method !== "GET" || !path.startsWith("/assets/")) {
      return false;
    }
    try {
      assertAllowedQueryParameters(requestUrl, new Set());
    } catch (error) {
      const failure = requireCodedError(error);
      writeError(response, 400, failure.code, failure.message);
      return true;
    }
    if (path === "/assets/operator.js") {
      try {
        requireBrowserSession(browserSessions, request);
      } catch (error) {
        const failure = requireCodedError(error);
        writeError(
          response,
          authenticationFailureStatus(failure.code),
          failure.code,
          failure.message,
        );
        return true;
      }
    }
    try {
      writeJavascript(response, browserAssetReader(path));
    } catch (error) {
      const failure = requireCodedError(error);
      const status =
        failure.code === "browser_asset_not_found"
          ? 404
          : failure.code === "browser_asset_unavailable"
            ? 503
            : 500;
      writeError(response, status, failure.code, failure.message);
    }
    return true;
  };
}
