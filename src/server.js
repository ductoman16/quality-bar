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

function requireFunction(value, message) {
  if (typeof value !== "function") {
    throw new TypeError(message);
  }
}

function requireBoundary(value, methods, name) {
  for (const method of methods) {
    if (typeof value?.[method] !== "function") {
      throw new TypeError(
        `${name} must provide the ${methods === SESSION_METHODS ? "session" : "token"} boundary`,
      );
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
 * @param {object} options
 * @param {object} options.browserSessions
 * @param {(path: string) => string} [options.browserAssetReader]
 * @param {object} options.implementerTokens
 * @param {string} options.browserOrigin
 * @param {{ requestFacts: Function }} options.requestSecurity
 * @param {{ create: Function }} options.reviews
 * @param {Function} options.readDurableCoreStatus
 * @param {Function} options.readSystemStatus
 * @param {Function} options.listAuthorityAttributions
 * @param {Function} options.recordAuthorityAttribution
 * @param {boolean} [options.secureBrowserCookie]
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

  const handleRequest = async (request, response) => {
    const requestUrl = new URL(request.url, "http://quality-bar.internal");
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
        durableCoreStatus.error,
        "Quality Bar is not ready",
      );
      return;
    }
    try {
      requestSecurity.requestFacts(request);
    } catch (error) {
      writeError(
        response,
        error.code === "https_required" ? 403 : 400,
        error.code ?? "request_security_unavailable",
        error.message ?? "Request security is unavailable",
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
        recordAuthorityAttribution({
          action: "authentication",
          channel:
            request.headers.authorization !== undefined
              ? "implementer_token"
              : "browser_session",
          errorCode: error.code ?? "authentication_unavailable",
          outcome: "failure",
        });
        writeError(
          response,
          authenticationFailureStatus(error.code),
          error.code ?? "authentication_unavailable",
          error.message ?? authenticationFailureMessage(error.code),
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
      if (response.headersSent) {
        response.destroy(error);
        return;
      }
      const unavailable = isUnavailableError(error);
      writeError(
        response,
        unavailable ? 503 : 500,
        unavailable ? error.code : "internal_error",
        unavailable ? error.message : "Internal server error",
      );
    });
  });
}
