import { canonicalOpenApiDocument } from "./canonical-api.js";
import {
  assertAllowedQueryParameters,
  browserMutationFailureStatus,
  isUnavailableError,
  readAuthorityAttributionQuery,
  readJsonRequest,
  requireBrowserMutationWithQuery,
} from "./http-request.js";
import { requireCodedError } from "./coded-error.js";
import { writeError, writeJson } from "./http-response.js";

/**
 * @typedef {{
 *   action: string,
 *   channel: string,
 *   errorCode?: string,
 *   outcome: string
 * }} AttributionEvent
 */
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
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 * @param {{
 *   browserOrigin: string,
 *   browserSessions: ReturnType<typeof import("./browser-session.js").createBrowserSessionService>,
 *   failureCode: string,
 *   mutate: (body: unknown) => unknown,
 *   requestUrl: URL,
 *   statusFor: (code: string, error: unknown) => number
 * }} options
 */
async function reviewMutation(
  request,
  response,
  {
    browserOrigin,
    browserSessions,
    failureCode,
    mutate,
    requestUrl,
    statusFor,
  },
) {
  try {
    requireBrowserMutationWithQuery(
      browserSessions,
      request,
      browserOrigin,
      requestUrl,
    );
    writeJson(response, 200, await mutate(await readJsonRequest(request)));
  } catch (error) {
    if (
      error instanceof Error &&
      (!("code" in error) || typeof error.code !== "string")
    ) {
      writeError(response, 500, failureCode, error.message);
      return;
    }
    const failure = requireCodedError(error);
    if (failure.message === "request_malformed") {
      writeError(response, 400, "request_malformed", "Request is malformed");
      return;
    }
    if (
      ["csrf_invalid", "origin_invalid", "authentication_required"].includes(
        failure.code,
      )
    ) {
      writeError(
        response,
        browserMutationFailureStatus(failure.code),
        failure.code,
        failure.message,
      );
      return;
    }
    writeError(
      response,
      statusFor(failure.code, error),
      failure.code,
      failure.message,
    );
  }
}

/**
 * @param {{
 *   browserOrigin: string,
 *   browserSessions: ReturnType<typeof import("./browser-session.js").createBrowserSessionService>,
 *   listAuthorityAttributions: (query: { cursor?: string, limit?: string }) => unknown,
 *   readSystemStatus: () => unknown,
 *   recordAuthorityAttribution: (event: AttributionEvent) => void,
 *   repositories: ReturnType<typeof import("./repository.js").createRepositoryService>,
 *   reviews: ReturnType<typeof import("./review.js").createReviewService>
 * }} dependencies
 */
export function createApiRoute({
  browserOrigin,
  browserSessions,
  listAuthorityAttributions,
  readSystemStatus,
  recordAuthorityAttribution,
  repositories,
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
    const reviewMetadataMatch = path.match(
      /^\/api\/v1\/reviews\/([^/]+)\/metadata$/,
    );
    const reviewArchivalMatch = path.match(
      /^\/api\/v1\/reviews\/([^/]+)\/archival$/,
    );
    const reviewActiveVersionMatch = path.match(
      /^\/api\/v1\/reviews\/([^/]+)\/active-version$/,
    );
    const reviewVersionsMatch = path.match(
      /^\/api\/v1\/reviews\/([^/]+)\/versions$/,
    );
    if (
      authority === "machine" &&
      ((method === "GET" && path === "/api/v1/reviews") ||
        (method === "PATCH" && reviewMetadataMatch) ||
        (method === "PATCH" && reviewArchivalMatch) ||
        (method === "PATCH" && reviewActiveVersionMatch) ||
        (method === "POST" && reviewVersionsMatch) ||
        (method === "POST" && path === "/api/v1/repositories"))
    ) {
      forbidMachineSystemAccess(response, recordAuthorityAttribution);
      return true;
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
        const failure = requireCodedError(error);
        writeError(response, 400, failure.code, failure.message);
        return true;
      }
    } else if (method === "GET" && path === "/api/v1/reviews") {
      try {
        assertAllowedQueryParameters(requestUrl, new Set(["state"]));
      } catch (error) {
        const failure = requireCodedError(error);
        writeError(response, 400, failure.code, failure.message);
        return true;
      }
    } else {
      try {
        assertAllowedQueryParameters(requestUrl, new Set());
      } catch (error) {
        const failure = requireCodedError(error);
        writeError(response, 400, failure.code, failure.message);
        return true;
      }
    }
    if (method === "GET" && path === "/api/v1/openapi.json") {
      writeJson(response, 200, canonicalOpenApiDocument());
      return true;
    }
    if (method === "GET" && path === "/api/v1/reviews") {
      try {
        writeJson(response, 200, {
          reviews: reviews.list(
            requestUrl.searchParams.get("state") ?? undefined,
          ),
        });
      } catch (error) {
        if (error instanceof Error && !("code" in error)) {
          writeError(response, 500, "review_list_failed", error.message);
          return true;
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
      return true;
    }
    if (method === "PATCH" && reviewArchivalMatch) {
      await reviewMutation(request, response, {
        browserOrigin,
        browserSessions,
        failureCode: "review_archival_failed",
        mutate: (body) =>
          reviews.setArchived(decodeURIComponent(reviewArchivalMatch[1]), body),
        requestUrl,
        statusFor: (code, error) =>
          code === "review_not_found"
            ? 404
            : isUnavailableError(error)
              ? 503
              : 422,
      });
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
        if (
          error instanceof Error &&
          (!("code" in error) || typeof error.code !== "string")
        ) {
          writeError(response, 500, "review_creation_failed", error.message);
          return true;
        }
        const failure = requireCodedError(error);
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
            failure.message,
          );
        } else {
          const unavailable = isUnavailableError(error);
          writeError(
            response,
            unavailable ? 503 : 422,
            failure.code,
            failure.message,
          );
        }
      }
      return true;
    }
    if (method === "POST" && path === "/api/v1/repositories") {
      await reviewMutation(request, response, {
        browserOrigin,
        browserSessions,
        failureCode: "repository_registration_failed",
        mutate: (body) => repositories.register(body),
        requestUrl,
        statusFor: (code, error) =>
          code === "repository_identity_conflict"
            ? 409
            : isUnavailableError(error) ||
                code === "repository_git_verification_unavailable"
              ? 503
              : 422,
      });
      return true;
    }
    if (method === "PATCH" && reviewMetadataMatch) {
      await reviewMutation(request, response, {
        browserOrigin,
        browserSessions,
        failureCode: "review_metadata_update_failed",
        mutate: (body) =>
          reviews.updateMetadata(
            decodeURIComponent(reviewMetadataMatch[1]),
            body,
          ),
        requestUrl,
        statusFor: (code, error) =>
          code === "review_not_found"
            ? 404
            : code === "review_name_conflict"
              ? 409
              : isUnavailableError(error)
                ? 503
                : 422,
      });
      return true;
    }
    if (method === "POST" && reviewVersionsMatch) {
      await reviewMutation(request, response, {
        browserOrigin,
        browserSessions,
        failureCode: "review_version_save_failed",
        mutate: (body) =>
          reviews.saveVersion(decodeURIComponent(reviewVersionsMatch[1]), body),
        requestUrl,
        statusFor: (code, error) =>
          code === "review_not_found"
            ? 404
            : code === "review_archived"
              ? 409
              : isUnavailableError(error)
                ? 503
                : 422,
      });
      return true;
    }
    if (method === "PATCH" && reviewActiveVersionMatch) {
      await reviewMutation(request, response, {
        browserOrigin,
        browserSessions,
        failureCode: "review_version_reactivation_failed",
        mutate: (body) =>
          reviews.reactivateVersion(
            decodeURIComponent(reviewActiveVersionMatch[1]),
            body,
          ),
        requestUrl,
        statusFor: (code, error) =>
          ["review_not_found", "review_version_not_found"].includes(code)
            ? 404
            : code === "review_archived"
              ? 409
              : isUnavailableError(error)
                ? 503
                : 422,
      });
      return true;
    }
    if (method === "GET" && path === "/api/v1/system") {
      try {
        writeJson(response, 200, readSystemStatus());
      } catch (error) {
        const failure = requireCodedError(error);
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
        const failure = requireCodedError(error);
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
