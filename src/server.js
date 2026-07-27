import { createServer } from "node:http";

import { readBrowserAsset } from "./browser-assets.js";
import { createApiRoute } from "./api-route.js";
import { createBrowserAssetRoute } from "./browser-asset-route.js";
import { createBrowserPageRoute } from "./browser-page-route.js";
import { createBrowserSessionRoute } from "./browser-session-route.js";
import {
  authenticationFailureStatus,
  hasUrlToken,
  isProductSurface,
  isUnavailableError,
  requireProductAuthority,
} from "./http-request.js";
import { requireCodedError } from "./coded-error.js";
import { writeError, writeJson } from "./http-response.js";

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
 *   repositories: ReturnType<typeof import("./repository.js").createRepositoryService>,
 *   repositoryGuidance: ReturnType<typeof import("./repository-guidance.js").createRepositoryGuidanceService>,
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
  repositories,
  repositoryGuidance,
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
  if (
    typeof reviews?.list !== "function" ||
    typeof reviews.create !== "function" ||
    typeof reviews.setArchived !== "function" ||
    typeof reviews.setAssignment !== "function" ||
    typeof reviews.selectForNewEvaluation !== "function" ||
    typeof reviews.updateMetadata !== "function"
  ) {
    throw new TypeError("reviews must provide the Review resource");
  }
  if (
    typeof repositories?.list !== "function" ||
    typeof repositories.register !== "function" ||
    typeof repositories.requireAcceptsNewWork !== "function" ||
    typeof repositories.rotateCredential !== "function" ||
    typeof repositories.setLifecycle !== "function"
  ) {
    throw new TypeError("repositories must provide the Repository resource");
  }
  if (typeof repositoryGuidance?.read !== "function") {
    throw new TypeError(
      "repositoryGuidance must provide the Repository Guidance resource",
    );
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
    repositories,
    repositoryGuidance,
    reviews,
  });

  /**
   * @param {import("node:http").IncomingMessage} request
   * @param {import("node:http").ServerResponse} response
   */
  const handleRequest = async (request, response) => {
    if (typeof request.url !== "string") {
      throw new TypeError("request.url is required");
    }
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
      if (typeof durableCoreStatus.error !== "string") {
        throw new TypeError("not-ready status must provide an error code");
      }
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
      const failure = requireCodedError(error);
      writeError(
        response,
        failure.code === "https_required" ? 403 : 400,
        failure.code,
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
        const failure = requireCodedError(error);
        recordAuthorityAttribution({
          action: "authentication",
          channel:
            request.headers.authorization !== undefined
              ? "implementer_token"
              : "browser_session",
          errorCode: failure.code,
          outcome: "failure",
        });
        writeError(
          response,
          authenticationFailureStatus(failure.code),
          failure.code,
          failure.message,
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
      const failure =
        error instanceof Error
          ? error
          : new TypeError("Request handler rejected with a non-Error", {
              cause: error,
            });
      if (response.headersSent) {
        response.destroy(failure);
        return;
      }
      if (isUnavailableError(failure)) {
        const unavailableFailure = requireCodedError(failure);
        writeError(
          response,
          503,
          unavailableFailure.code,
          unavailableFailure.message,
        );
        return;
      }
      writeError(response, 500, "internal_error", "Internal server error");
    });
  });
}
