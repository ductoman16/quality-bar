import { canonicalOpenApiDocument } from "./canonical-api.js";
import {
  assertAllowedQueryParameters,
  authenticationFailureMessage,
  browserMutationFailureStatus,
  isUnavailableError,
  readAuthorityAttributionQuery,
  readJsonRequest,
  requireBrowserMutationWithQuery,
} from "./http-request.js";
import { writeError, writeJson } from "./http-response.js";

/**
 * @typedef {{
 *   action: string,
 *   channel: string,
 *   errorCode?: string,
 *   outcome: string
 * }} AttributionEvent
 */
/** @param {unknown} error */
function apiError(error) {
  return {
    code:
      error instanceof Error &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : "internal_error",
    message: error instanceof Error ? error.message : "Internal server error",
  };
}

/**
 * @param {import("node:http").ServerResponse} response
 * @param {(event: AttributionEvent) => void} recordAuthorityAttribution
 */
function forbidMachineSystemAccess(response, recordAuthorityAttribution) {
  recordAuthorityAttribution({
    action: "authorization",
    channel: "implementer_token",
    errorCode: "authorization_forbidden",
    outcome: "forbidden",
  });
  writeError(
    response,
    403,
    "authorization_forbidden",
    "Machine access is forbidden",
  );
}

/**
 * @param {{
 *   browserOrigin: string,
 *   browserSessions: ReturnType<typeof import("./browser-session.js").createBrowserSessionService>,
 *   listAuthorityAttributions: (query: { cursor?: string, limit?: string }) => unknown,
 *   readSystemStatus: () => unknown,
 *   recordAuthorityAttribution: (event: AttributionEvent) => void,
 *   reviews: ReturnType<typeof import("./review.js").createReviewService>
 * }} dependencies
 */
export function createApiRoute({
  browserOrigin,
  browserSessions,
  listAuthorityAttributions,
  readSystemStatus,
  recordAuthorityAttribution,
  reviews,
}) {
  /**
   * @param {import("node:http").IncomingMessage} request
   * @param {import("node:http").ServerResponse} response
   * @param {URL} requestUrl
   * @param {"machine" | "operator" | undefined} authority
   */
  return async function handleApi(request, response, requestUrl, authority) {
    const { method } = request;
    const path = requestUrl.pathname;
    if (path !== "/api/v1" && !path.startsWith("/api/v1/")) {
      return false;
    }
    if (
      authority === "machine" &&
      ["/api/v1/system", "/api/v1/system/authority-attributions"].includes(path)
    ) {
      forbidMachineSystemAccess(response, recordAuthorityAttribution);
      return true;
    }
    if (path === "/api/v1/system/authority-attributions") {
      try {
        assertAllowedQueryParameters(requestUrl, new Set(["cursor", "limit"]));
      } catch (error) {
        const failure = apiError(error);
        writeError(response, 400, failure.code, failure.message);
        return true;
      }
    } else {
      try {
        assertAllowedQueryParameters(requestUrl, new Set());
      } catch (error) {
        const failure = apiError(error);
        writeError(response, 400, failure.code, failure.message);
        return true;
      }
    }
    if (method === "GET" && path === "/api/v1/openapi.json") {
      writeJson(response, 200, canonicalOpenApiDocument());
      return true;
    }
    if (method === "POST" && path === "/api/v1/reviews") {
      try {
        if (authority !== "machine") {
          requireBrowserMutationWithQuery(
            browserSessions,
            request,
            browserOrigin,
            requestUrl,
          );
        }
        writeJson(
          response,
          201,
          reviews.create(await readJsonRequest(request)),
        );
      } catch (error) {
        const failure = apiError(error);
        if (failure.message === "request_malformed") {
          writeError(
            response,
            400,
            "request_malformed",
            "Request is malformed",
          );
        } else if (
          authority !== "machine" &&
          [
            "csrf_invalid",
            "origin_invalid",
            "authentication_required",
          ].includes(failure.code)
        ) {
          writeError(
            response,
            browserMutationFailureStatus(failure.code),
            failure.code,
            failure.message || authenticationFailureMessage(failure.code),
          );
        } else {
          const unavailable = isUnavailableError(error);
          const code = unavailable
            ? failure.code
            : failure.code === "internal_error"
              ? "review_creation_failed"
              : failure.code;
          writeError(
            response,
            unavailable ? 503 : failure.code !== "internal_error" ? 422 : 500,
            code,
            failure.message || "Review creation failed",
          );
        }
      }
      return true;
    }
    if (method === "GET" && path === "/api/v1/system") {
      try {
        writeJson(response, 200, readSystemStatus());
      } catch (error) {
        const failure = apiError(error);
        writeError(
          response,
          isUnavailableError(error) ? 503 : 500,
          isUnavailableError(error) ? failure.code : "internal_error",
          isUnavailableError(error) ? failure.message : "Internal server error",
        );
      }
      return true;
    }
    if (method === "GET" && path === "/api/v1/system/authority-attributions") {
      try {
        writeJson(
          response,
          200,
          listAuthorityAttributions(readAuthorityAttributionQuery(requestUrl)),
        );
      } catch (error) {
        const failure = apiError(error);
        const status = [
          "cursor_invalid",
          "page_size_invalid",
          "request_malformed",
        ].includes(failure.code)
          ? 400
          : isUnavailableError(error)
            ? 503
            : 500;
        writeError(
          response,
          status,
          status === 400 || status === 503 ? failure.code : "internal_error",
          status === 400
            ? "Request is malformed"
            : status === 503
              ? failure.message
              : "Internal server error",
        );
      }
      return true;
    }
    return false;
  };
}
