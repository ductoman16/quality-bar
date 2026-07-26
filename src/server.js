import { createServer } from "node:http";

import { readBrowserAsset } from "./browser-assets.js";
import { createApiRoute } from "./api-route.js";
import { createBrowserAssetRoute } from "./browser-asset-route.js";
import { createBrowserPageRoute } from "./browser-page-route.js";
import { createBrowserSessionRoute } from "./browser-session-route.js";
import {
  authenticationFailureMessage,
  authenticationFailureStatus,
  hasUrlToken,
  isProductSurface,
  isUnavailableError,
  requireProductAuthority,
} from "./http-request.js";
import { writeError, writeJson } from "./http-response.js";

/** @param {unknown} error */
function serverError(error) {
  return {
    code:
      error instanceof Error &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : "internal_error",
    error: error instanceof Error ? error : new Error("Internal server error"),
    message: error instanceof Error ? error.message : "Internal server error",
  };
}

/**
 * @param {unknown} value
 * @param {string} message
 * @returns {asserts value is (...arguments_: never[]) => unknown}
 */
function requireFunction(value, message) {
  if (typeof value !== "function") {
    throw new TypeError(message);
  }
}

/**
 * @param {unknown} value
 * @param {string[]} methods
 * @param {string} name
 */
function requireBoundary(value, methods, name) {
  const boundaryName = methods === SESSION_METHODS ? "session" : "token";
  if (!value || typeof value !== "object") {
    throw new TypeError(`${name} must provide the ${boundaryName} boundary`);
  }
  for (const method of methods) {
    if (
      typeof (/** @type {Record<string, unknown>} */ (value)[method]) !==
      "function"
    ) {
      throw new TypeError(`${name} must provide the ${boundaryName} boundary`);
    }
  }
}

const SESSION_METHODS = [
  "authenticate",
  "isBootstrapped",
  "login",
  "logout",
  "changePassword",
  "revokeAll",
  "touch",
  "verifyCsrf",
];
const TOKEN_METHODS = [
  "authenticate",
  "create",
  "hasActiveToken",
  "revoke",
  "rotate",
];

/**
 * @param {{
 *   browserSessions: ReturnType<typeof import("./browser-session.js").createBrowserSessionService>,
 *   browserAssetReader?: (path: string) => string,
 *   implementerTokens: ReturnType<typeof import("./implementer-token.js").createImplementerTokenService>,
 *   browserOrigin: string,
 *   requestSecurity: ReturnType<typeof import("./request-security.js").createRequestSecurityBoundary>,
 *   reviews: ReturnType<typeof import("./review.js").createReviewService>,
 *   readDurableCoreStatus: () => { error?: string, status: string },
 *   readSystemStatus: () => unknown,
 *   listAuthorityAttributions: (query: { cursor?: string, limit?: string }) => unknown,
 *   recordAuthorityAttribution: (event: {
 *     action: string,
 *     channel: string,
 *     errorCode?: string,
 *     outcome: string
 *   }) => void,
 *   secureBrowserCookie?: boolean
 * }} options
 */
export function createApplicationServer({
  browserSessions,
  browserAssetReader = readBrowserAsset,
  implementerTokens,
  browserOrigin,
  requestSecurity,
  reviews,
  readDurableCoreStatus,
  readSystemStatus,
  listAuthorityAttributions,
  recordAuthorityAttribution,
  secureBrowserCookie = false,
}) {
  requireFunction(readDurableCoreStatus, "readDurableCoreStatus is required");
  requireFunction(browserAssetReader, "browserAssetReader must be a function");
  requireFunction(
    listAuthorityAttributions,
    "listAuthorityAttributions must be a function",
  );
  requireFunction(
    recordAuthorityAttribution,
    "recordAuthorityAttribution must be a function",
  );
  requireBoundary(browserSessions, SESSION_METHODS, "browserSessions");
  requireBoundary(implementerTokens, TOKEN_METHODS, "implementerTokens");
  if (typeof requestSecurity?.requestFacts !== "function") {
    throw new TypeError("requestSecurity must provide the request boundary");
  }
  requireFunction(readSystemStatus, "readSystemStatus must be a function");
  if (typeof reviews?.create !== "function") {
    throw new TypeError("reviews must provide the Review resource");
  }

  const handleBrowserAsset = createBrowserAssetRoute({
    browserAssetReader,
    browserSessions,
  });
  const handleBrowserSession = createBrowserSessionRoute({
    browserOrigin,
    browserSessions,
    implementerTokens,
    recordAuthorityAttribution,
    secureBrowserCookie,
  });
  const handleBrowserPage = createBrowserPageRoute({
    browserSessions,
    implementerTokens,
    recordAuthorityAttribution,
  });
  const handleApi = createApiRoute({
    browserOrigin,
    browserSessions,
    listAuthorityAttributions,
    readSystemStatus,
    recordAuthorityAttribution,
    reviews,
  });

  /**
   * @param {import("node:http").IncomingMessage} request
   * @param {import("node:http").ServerResponse} response
   */
  const handleRequest = async (request, response) => {
    const requestUrl = new URL(
      request.url ?? "/",
      "http://quality-bar.internal",
    );
    const path = requestUrl.pathname;
    if (request.method === "GET" && path === "/health/live") {
      writeJson(response, 200, { status: "live" });
      return;
    }

    const durableCoreStatus = readDurableCoreStatus();
    if (request.method === "GET" && path === "/health/ready") {
      if (durableCoreStatus.status === "ready") {
        writeJson(response, 200, { status: "ready" });
      } else {
        writeJson(response, 503, durableCoreStatus);
      }
      return;
    }
    if (isProductSurface(path) && durableCoreStatus.status !== "ready") {
      writeError(
        response,
        503,
        durableCoreStatus.error ?? "storage_unavailable",
        "Quality Bar is not ready",
      );
      return;
    }
    try {
      requestSecurity.requestFacts(request);
    } catch (error) {
      const failure = serverError(error);
      writeError(
        response,
        failure.code === "https_required" ? 403 : 400,
        failure.code === "internal_error"
          ? "request_security_unavailable"
          : failure.code,
        failure.message,
      );
      return;
    }
    if (hasUrlToken(requestUrl)) {
      recordAuthorityAttribution({
        action: "authentication",
        channel: "implementer_token",
        errorCode: "authentication_invalid",
        outcome: "failure",
      });
      writeError(
        response,
        401,
        "authentication_invalid",
        "Machine authentication is invalid",
      );
      return;
    }
    if (handleBrowserAsset(request, response, requestUrl)) {
      return;
    }
    if (await handleBrowserSession(request, response, requestUrl)) {
      return;
    }
    if (handleBrowserPage(request, response, requestUrl)) {
      return;
    }
    if (path === "/api/v1/operator-password/bootstrap") {
      writeError(response, 404, "not_found", "Resource was not found");
      return;
    }
    let authority;
    if (isProductSurface(path)) {
      try {
        authority = requireProductAuthority(
          browserSessions,
          implementerTokens,
          request,
          requestUrl,
        );
      } catch (error) {
        const failure = serverError(error);
        recordAuthorityAttribution({
          action: "authentication",
          channel:
            request.headers.authorization !== undefined
              ? "implementer_token"
              : "browser_session",
          errorCode:
            failure.code === "internal_error"
              ? "authentication_unavailable"
              : failure.code,
          outcome: "failure",
        });
        writeError(
          response,
          authenticationFailureStatus(failure.code),
          failure.code === "internal_error"
            ? "authentication_unavailable"
            : failure.code,
          failure.message || authenticationFailureMessage(failure.code),
        );
        return;
      }
    }
    if (await handleApi(request, response, requestUrl, authority)) {
      return;
    }
    writeError(response, 404, "not_found", "Resource was not found");
  };

  return createServer((request, response) => {
    handleRequest(request, response).catch((error) => {
      const failure = serverError(error);
      if (response.headersSent) {
        response.destroy(failure.error);
        return;
      }
      const unavailable = isUnavailableError(error);
      writeError(
        response,
        unavailable ? 503 : 500,
        unavailable ? failure.code : "internal_error",
        unavailable ? failure.message : "Internal server error",
      );
    });
  });
}
