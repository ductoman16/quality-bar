import { readBrowserAsset } from "./browser-assets.js";
import { createApiOperations } from "./api-route.js";
import { createBrowserAssetRoute } from "./browser-asset-route.js";
import { createBrowserPageRoute } from "./browser-page-route.js";
import { createBrowserSessionOperations } from "./browser-session-route.js";
import { createCanonicalComponents } from "./canonical-api-components.js";
import { readCodexCapabilityCatalog } from "./codex-capabilities.js";
import { createCodexExecutionConcurrencyOperations } from "./codex-execution-concurrency-route.js";
import { requireCodedError } from "./coded-error.js";
import { createEvaluationOperations } from "./evaluation-route.js";
import { createForgejoConnectionRoute } from "./forgejo-connection-route.js";
import {
  allowedSecuritySchemes,
  createFastify,
  notReadyMessage,
  registerApiRoutes,
  requestUrl,
} from "./fastify-listener.js";
import {
  authenticationFailureStatus,
  bearerToken,
  hasUrlToken,
  isProductSurface,
  requireProductAuthority,
} from "./http-request.js";
import { writeError } from "./http-response.js";
import { createGitHubConnectionRoute } from "./github-connection-route.js";
import { createMcpRoute } from "./mcp-route.js";
import { createOnboardingApiOperations } from "./onboarding-api-route.js";
import { createOnboardingOperations } from "./onboarding-operations.js";
import { createProductRequestRunner } from "./product-request-runtime.js";
import { createWaiverAdjudicatorConfigurationOperations } from "./waiver-adjudicator-configuration-route.js";

const JSON_TYPE = "application/json";

/**
 * @param {any} dependencies
 * @returns {import("fastify").FastifyInstance}
 */
export function createApplicationServer(dependencies) {
  const {
    browserSessions,
    browserAssetReader = readBrowserAsset,
    implementerTokens,
    onboardingTokens,
    browserOrigin,
    requestSecurity,
    repositories,
    githubConnections,
    forgejoConnections,
    repositoryGuidance,
    evaluations,
    reviews,
    waiverAdjudicatorConfiguration,
    codexExecutionConcurrency,
    readDurableCoreStatus,
    readSystemStatus,
    listAuthorityAttributions,
    recordAuthorityAttribution,
    recordMcpOperation,
    secureBrowserCookie = false,
    workerSignal,
  } = dependencies;
  const server = createFastify(
    createCanonicalComponents(readCodexCapabilityCatalog()),
  );
  const runProductRequest = createProductRequestRunner(workerSignal);
  const handleBrowserAsset = createBrowserAssetRoute({
    browserAssetReader,
    browserSessions,
  });
  const sessionOperations = createBrowserSessionOperations({
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
  const waiverConfigurationOperations =
    createWaiverAdjudicatorConfigurationOperations({
      browserOrigin,
      browserSessions,
      waiverAdjudicatorConfiguration,
    });
  const evaluationOperations = createEvaluationOperations({
    browserOrigin,
    browserSessions,
    evaluations,
    recordAuthorityAttribution,
  });
  const concurrencyOperations = createCodexExecutionConcurrencyOperations({
    browserOrigin,
    browserSessions,
    codexExecutionConcurrency,
  });
  const apiOperations = createApiOperations({
    analytics: { read: evaluations.readAnalytics },
    browserOrigin,
    browserSessions,
    listAuthorityAttributions,
    readSystemStatus,
    repositories,
    repositoryGuidance,
    reviews,
  });
  const onboardingOperations = createOnboardingOperations({
    evaluations,
    onboardingTokens,
    repositories,
    repositoryGuidance,
    reviews,
  });
  const onboardingApiOperations =
    /** @type {Record<string, (request: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) => unknown>} */ (
      createOnboardingApiOperations({
        browserOrigin,
        browserSessions,
        onboardingTokens,
        operations: onboardingOperations,
      })
    );
  const handleMcp = createMcpRoute({
    browserOrigin,
    evaluations,
    onboardingOperations,
    recordMcpOperation,
    repositories,
    repositoryGuidance,
  });
  /** @type {Record<string, (request: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) => unknown>} */
  const standardOperationHandlers = {
    ...apiOperations,
    ...concurrencyOperations,
    ...createForgejoConnectionRoute({
      browserOrigin,
      browserSessions,
      forgejoConnections,
    }),
    ...createGitHubConnectionRoute({
      browserOrigin,
      browserSessions,
      githubConnections,
    }),
    ...evaluationOperations,
    ...sessionOperations,
    ...waiverConfigurationOperations,
  };
  /** @type {Record<string, (request: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) => unknown>} */
  const operationHandlers = {
    ...standardOperationHandlers,
    ...onboardingApiOperations,
  };
  for (const operationId of [
    "createExplicitEvaluation",
    "getEvaluation",
    "getEvaluationResult",
    "getRepositoryGuidance",
    "listGenericRepositories",
    "listReviews",
  ]) {
    const standardHandler = standardOperationHandlers[operationId];
    const onboardingHandler = onboardingApiOperations[operationId];
    operationHandlers[operationId] = (request, reply) =>
      /** @type {any} */ (request).authority === "onboarding"
        ? onboardingHandler(request, reply)
        : standardHandler(request, reply);
  }

  server.register(async (routes) => {
    routes.addHook("onRequest", (request, reply, done) => {
      const productRequest = /** @type {any} */ (request);
      const url = requestUrl(request);
      const path = url.pathname;
      runProductRequest(path, () => {
        if (path === "/health/live" || path === "/health/ready") {
          done();
          return;
        }
        const durableCoreStatus = readDurableCoreStatus();
        if (isProductSurface(path) && durableCoreStatus.status !== "ready") {
          const code = durableCoreStatus.error;
          if (typeof code !== "string") {
            done(new TypeError("not-ready status must provide an error code"));
            return;
          }
          writeError(reply, 503, code, notReadyMessage(code));
          return;
        }
        try {
          requestSecurity.requestFacts(request.raw);
        } catch (error) {
          const failure = requireCodedError(error);
          writeError(
            reply,
            failure.code === "https_required" ? 403 : 400,
            failure.code,
            failure.message,
          );
          return;
        }
        try {
          if (hasUrlToken(url)) {
            throw Object.assign(
              new Error("Machine authentication is invalid"),
              { code: "authentication_invalid" },
            );
          }
          const schemes = allowedSecuritySchemes(request);
          if (schemes.size > 0) {
            if (
              path === "/mcp/v1" &&
              request.headers.authorization === undefined
            ) {
              throw Object.assign(
                new Error("Machine authentication is invalid"),
                { code: "authentication_invalid" },
              );
            }
            productRequest.authority = requireProductAuthority(
              browserSessions,
              implementerTokens,
              onboardingTokens,
              request,
              url,
            );
            const scheme = /** @type {Record<string, string>} */ ({
              machine: "implementer_token",
              onboarding: "onboarding_token",
              operator: "browser_session",
            })[productRequest.authority];
            if (!schemes.has(scheme)) {
              if (productRequest.authority === "onboarding") {
                recordAuthorityAttribution({
                  action: "onboarding_scope",
                  channel: "onboarding_token",
                  outcome: "forbidden",
                });
                writeError(
                  reply,
                  403,
                  "onboarding_scope_forbidden",
                  "Onboarding token cannot access this resource",
                );
                return;
              }
              throw Object.assign(new Error("Machine access is forbidden"), {
                code: "authorization_forbidden",
              });
            }
            productRequest.onboardingGrant =
              productRequest.authority === "onboarding"
                ? onboardingTokens.authenticate(bearerToken(request))
                : null;
          }
        } catch (error) {
          const failure = requireCodedError(error);
          recordAuthorityAttribution({
            action:
              failure.code === "authorization_forbidden"
                ? "authorization"
                : "authentication",
            channel:
              request.headers.authorization === undefined
                ? "browser_session"
                : "implementer_token",
            errorCode: failure.code,
            outcome:
              failure.code === "authorization_forbidden"
                ? "forbidden"
                : "failure",
          });
          writeError(
            reply,
            failure.code === "authorization_forbidden"
              ? 403
              : authenticationFailureStatus(failure.code),
            failure.code,
            failure.message,
          );
          return;
        }
        if (
          path !== "/mcp/v1" &&
          request.routeOptions.schema?.body !== undefined &&
          request.headers["content-type"] !== JSON_TYPE
        ) {
          writeError(reply, 400, "request_malformed", "Request is malformed");
          return;
        }
        if (request.routeOptions.schema?.body === undefined) {
          delete request.headers["content-type"];
        }
        done();
      });
    });
    routes.get("/health/live", () => ({ status: "live" }));
    routes.get("/health/ready", (request, reply) => {
      void request;
      const status = readDurableCoreStatus();
      return status.status === "ready"
        ? { status: "ready" }
        : reply.code(503).send(status);
    });
    routes.get("/", (request, reply) =>
      handleBrowserPage(request, reply, requestUrl(request)),
    );
    routes.get(
      "/assets/*",
      {
        schema: {
          querystring: {
            additionalProperties: false,
            properties: {},
            type: "object",
          },
        },
      },
      (request, reply) =>
        handleBrowserAsset(request, reply, requestUrl(request)),
    );
    routes.post(
      "/mcp/v1",
      {
        schema: {
          body: {},
          hide: true,
          querystring: {
            additionalProperties: false,
            properties: {},
            type: "object",
          },
          security: [{ implementer_token: [] }, { onboarding_token: [] }],
        },
      },
      (request, reply) => {
        const productRequest = /** @type {any} */ (request);
        return handleMcp(
          request,
          reply,
          productRequest.authority,
          productRequest.onboardingGrant,
          bearerToken(request),
        );
      },
    );
    routes.route({
      handler() {},
      method: ["DELETE", "GET", "PATCH", "PUT"],
      onRequest(request, reply) {
        void request;
        writeError(reply, 405, "method_not_allowed", "Method is not allowed", {
          allow: "POST",
        });
      },
      schema: {
        hide: true,
        security: [{ implementer_token: [] }, { onboarding_token: [] }],
      },
      url: "/mcp/v1",
    });
    registerApiRoutes(routes, operationHandlers);
  });
  return server;
}
