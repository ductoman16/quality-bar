import {
  assertAllowedQueryParameters,
  authenticationFailureMessage,
  authenticationFailureStatus,
  requireBrowserSession,
} from "./http-request.js";
import { writeError, writeJavascript } from "./http-response.js";

export function createBrowserAssetRoute({
  browserAssetReader,
  browserSessions,
}) {
  return function handleBrowserAsset(request, response, requestUrl) {
    const path = requestUrl.pathname;
    if (request.method !== "GET" || !path.startsWith("/assets/")) {
      return false;
    }
    try {
      assertAllowedQueryParameters(requestUrl, new Set());
    } catch (error) {
      writeError(
        response,
        400,
        error.code ?? "request_malformed",
        error.message ?? "Request is malformed",
      );
      return true;
    }
    if (path === "/assets/operator.js") {
      try {
        requireBrowserSession(browserSessions, request);
      } catch (error) {
        writeError(
          response,
          authenticationFailureStatus(error.code),
          error.code ?? "authentication_unavailable",
          error.message ?? authenticationFailureMessage(error.code),
        );
        return true;
      }
    }
    try {
      writeJavascript(response, browserAssetReader(path));
    } catch (error) {
      const status =
        error.code === "browser_asset_not_found"
          ? 404
          : error.code === "browser_asset_unavailable"
            ? 503
            : 500;
      writeError(
        response,
        status,
        error.code ?? "browser_asset_unavailable",
        error.message ?? "Browser asset is unavailable",
      );
    }
    return true;
  };
}
