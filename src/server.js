import { createServer } from "node:http";

import { readBrowserAsset } from "./browser-assets.js";
import { createApiRoute } from "./api-route.js";
import { createBrowserAssetRoute } from "./browser-asset-route.js";
import { createBrowserPageRoute } from "./browser-page-route.js";
import { createBrowserSessionRoute } from "./browser-session-route.js";
import { createMcpRoute } from "./mcp-route.js";
import {
  authenticationFailureStatus,
  hasUrlToken,
  isProductSurface,
  isUnavailableError,
  requireImplementerTokenAuthority,
  requireProductAuthority,
} from "./http-request.js";
import { requireCodedError } from "./coded-error.js";
import { writeError, writeJson } from "./http-response.js";
import { createWaiverAdjudicatorConfigurationRoute } from "./waiver-adjudicator-configuration-route.js";
import { createEvaluationRoute } from "./evaluation-route.js";

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
 *   repositories: Omit<ReturnType<typeof import("./repository.js").createRepositoryService>, "resolvePushedSelectors" | "resolvePullRequestChangeset">,
 *   githubConnections: ReturnType<typeof import("./github-connection.js").createGitHubConnectionService>,
 *   forgejoConnections?: ReturnType<typeof import("./forgejo-connection.js").createForgejoConnectionService>,
 *   repositoryGuidance: ReturnType<typeof import("./repository-guidance.js").createRepositoryGuidanceService>,
 *   evaluations: ReturnType<typeof import("./evaluation.js").createEvaluationService>,
 *   reviews: ReturnType<typeof import("./review.js").createReviewService>,
 *   waiverAdjudicatorConfiguration: ReturnType<typeof import("./waiver-adjudicator-configuration.js").createWaiverAdjudicatorConfigurationService>,
 *   readDurableCoreStatus: () => { error?: string, status: string },
 *   readSystemStatus: () => unknown,
 *   listAuthorityAttributions: (query: { cursor?: string, limit?: string }) => unknown,
 *   recordAuthorityAttribution: (event: {
 *     action: string,
 *     channel: string,
 *     errorCode?: string,
 *     outcome: string
 *   }) => void,
 *   recordMcpOperation: (event: {
 *     durationMs: number,
 *     errorCode?: string,
 *     operation: string,
 *     outcome: "success" | "failure",
 *     requestId: string,
 *     resourceIds: string[]
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
  githubConnections,
  forgejoConnections,
  repositoryGuidance,
  evaluations,
  reviews,
  waiverAdjudicatorConfiguration,
  readDurableCoreStatus,
  readSystemStatus,
  listAuthorityAttributions,
  recordAuthorityAttribution,
  recordMcpOperation,
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
    typeof waiverAdjudicatorConfiguration?.read !== "function" ||
    typeof waiverAdjudicatorConfiguration.update !== "function" ||
    typeof waiverAdjudicatorConfiguration.freezeForAdjudication !== "function"
  ) {
    throw new TypeError(
      "waiverAdjudicatorConfiguration must provide the Waiver Adjudicator Configuration resource",
    );
  }
  if (
    typeof forgejoConnections?.read !== "function" ||
    typeof forgejoConnections.connect !== "function" ||
    typeof forgejoConnections.discover !== "function" ||
    typeof forgejoConnections.rotate !== "function" ||
    typeof forgejoConnections.reactivate !== "function" ||
    typeof forgejoConnections.retire !== "function" ||
    typeof forgejoConnections.remove !== "function"
  ) {
    throw new TypeError(
      "forgejoConnections must provide the Forgejo Connection resource",
    );
  }
  if (
    typeof repositories?.list !== "function" ||
    typeof repositories.listPage !== "function" ||
    typeof repositories.register !== "function" ||
    typeof repositories.remove !== "function" ||
    typeof repositories.requireAcceptsNewWork !== "function" ||
    typeof repositories.rotateCredential !== "function" ||
    typeof repositories.setLifecycle !== "function"
  ) {
    throw new TypeError("repositories must provide the Repository resource");
  }
  if (
    typeof githubConnections?.read !== "function" ||
    typeof githubConnections.start !== "function" ||
    typeof githubConnections.completeManifest !== "function" ||
    typeof githubConnections.completeInstallation !== "function" ||
    typeof githubConnections.selectRepositories !== "function" ||
    typeof githubConnections.recordCallbackFailure !== "function" ||
    typeof githubConnections.consumeCallbackFailure !== "function"
  ) {
    throw new TypeError(
      "githubConnections must provide the GitHub Connection resource",
    );
  }
  if (typeof repositoryGuidance?.read !== "function") {
    throw new TypeError(
      "repositoryGuidance must provide the Repository Guidance resource",
    );
  }
  if (
    typeof evaluations?.destroy !== "function" ||
    typeof evaluations?.createExplicit !== "function" ||
    typeof evaluations.list !== "function" ||
    typeof evaluations.read !== "function" ||
    typeof evaluations.readAnalytics !== "function" ||
    typeof evaluations.readResult !== "function" ||
    typeof evaluations.readFinding !== "function" ||
    typeof evaluations.readFindingById !== "function" ||
    typeof evaluations.readReviewRun !== "function" ||
    typeof evaluations.readReviewRunById !== "function" ||
    typeof evaluations.readReviewRunDiagnostics !== "function" ||
    typeof evaluations.submitWaiverBatch !== "function" ||
    typeof evaluations.recoverWaiverAdjudication !== "function" ||
    typeof evaluations.retryWaiverErrors !== "function"
  ) {
    throw new TypeError("evaluations must provide the Evaluation resource");
  }
  requireFunction(recordMcpOperation, "recordMcpOperation must be a function");

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
  const handleWaiverAdjudicatorConfiguration =
    createWaiverAdjudicatorConfigurationRoute({
      browserOrigin,
      browserSessions,
      recordAuthorityAttribution,
      waiverAdjudicatorConfiguration,
    });
  const handleEvaluation = createEvaluationRoute({
    browserOrigin,
    browserSessions,
    evaluations,
    recordAuthorityAttribution,
  });
  const handleApi = createApiRoute({
    browserOrigin,
    browserSessions,
    listAuthorityAttributions,
    readSystemStatus,
    recordAuthorityAttribution,
    repositories,
    githubConnections,
    forgejoConnections: /** @type {any} */ (forgejoConnections),
    repositoryGuidance,
    reviews,
    analytics: { read: evaluations.readAnalytics },
  });
  const handleMcp = createMcpRoute({
    browserOrigin,
    evaluations,
    recordMcpOperation,
    repositories,
    repositoryGuidance,
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
    /** @type {"callback" | "machine" | "operator" | undefined} */
    let authority;
    if (isProductSurface(path)) {
      try {
        if (
          request.method === "GET" &&
          [
            "/api/v1/github-connections/manifest/callback",
            "/api/v1/github-connections/setup",
          ].includes(path)
        ) {
          authority = "callback";
        } else if (path === "/mcp/v1") {
          requireImplementerTokenAuthority(implementerTokens, request);
          authority = "machine";
        } else {
          authority = requireProductAuthority(
            browserSessions,
            implementerTokens,
            request,
            requestUrl,
          );
        }
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
    if (await handleMcp(request, response, requestUrl)) {
      return;
    }
    if (
      await handleWaiverAdjudicatorConfiguration(
        request,
        response,
        requestUrl,
        authority,
      )
    ) {
      return;
    }
    if (await handleEvaluation(request, response, requestUrl, authority)) {
      return;
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
