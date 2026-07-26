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

export function createApiRoute({
  browserOrigin,
  browserSessions,
  listAuthorityAttributions,
  readSystemStatus,
  recordAuthorityAttribution,
  reviews,
}) {
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
        writeError(response, 400, error.code, error.message);
        return true;
      }
    } else {
      try {
        assertAllowedQueryParameters(requestUrl, new Set());
      } catch (error) {
        writeError(response, 400, error.code, error.message);
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
        if (error.message === "request_malformed") {
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
          ].includes(error.code)
        ) {
          writeError(
            response,
            browserMutationFailureStatus(error.code),
            error.code,
            error.message ?? authenticationFailureMessage(error.code),
          );
        } else {
          const unavailable = isUnavailableError(error);
          const code = unavailable
            ? error.code
            : (error.code ?? "review_creation_failed");
          writeError(
            response,
            unavailable ? 503 : error.code ? 422 : 500,
            code,
            error.message ?? "Review creation failed",
          );
        }
      }
      return true;
    }
    if (method === "GET" && path === "/api/v1/system") {
      try {
        writeJson(response, 200, readSystemStatus());
      } catch (error) {
        writeError(
          response,
          isUnavailableError(error) ? 503 : 500,
          isUnavailableError(error) ? error.code : "internal_error",
          isUnavailableError(error) ? error.message : "Internal server error",
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
        const status = [
          "cursor_invalid",
          "page_size_invalid",
          "request_malformed",
        ].includes(error.code)
          ? 400
          : isUnavailableError(error)
            ? 503
            : 500;
        writeError(
          response,
          status,
          status === 400 || status === 503 ? error.code : "internal_error",
          status === 400
            ? "Request is malformed"
            : status === 503
              ? error.message
              : "Internal server error",
        );
      }
      return true;
    }
    return false;
  };
}
