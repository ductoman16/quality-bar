import { METHODS } from "node:http";

import { readBrowserAsset } from "./browser-assets.js";
import { createApiOperations } from "./api-route.js";
import { createBrowserAssetRoute } from "./browser-asset-route.js";
import { createBrowserPageRoute } from "./browser-page-route.js";
import {
  createBrowserSessionOperations,
  recordBrowserSessionBoundaryFailure,
} from "./browser-session-route.js";
import { createCanonicalComponents } from "./canonical-api-components.js";
import { readCodexCapabilityCatalog } from "./codex-capabilities.js";
import { createCodexExecutionConcurrencyOperations } from "./codex-execution-concurrency-route.js";
import { createEvaluationOperations } from "./evaluation-route.js";
import { createForgejoConnectionRoute } from "./forgejo-connection-route.js";
import {
  createFastify,
  registerApiRoutes,
  requestUrl,
} from "./fastify-listener.js";
import { createFastifyProductHook } from "./fastify-product-hook.js";
import { canonicalFastifyValidationError } from "./fastify-validation-error.js";
import { bearerToken } from "./http-request.js";
import { writeError } from "./http-response.js";
import {
  createGitHubCallbackValidationErrorHandler,
  createGitHubConnectionRoute,
} from "./github-connection-route.js";
import {
  createMcpOriginHook,
  createMcpRoute,
  rejectMcpMethod,
} from "./mcp-route.js";
import { createOnboardingApiOperations } from "./onboarding-api-route.js";
import { createOnboardingOperations } from "./onboarding-operations.js";
import { createProductRequestRunner } from "./product-request-runtime.js";
import { createWaiverAdjudicatorConfigurationOperations } from "./waiver-adjudicator-configuration-route.js";

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
  server.decorateRequest("browserSessionSecret", null);
  for (const method of METHODS) {
    if (!server.supportedMethods.includes(method)) {
      server.addHttpMethod(method);
    }
  }
  const runProductRequest = createProductRequestRunner(workerSignal);
  const handleBrowserAsset = createBrowserAssetRoute({
    browserAssetReader,
    browserSessions,
  });
  const sessionOperations = createBrowserSessionOperations({
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
      waiverAdjudicatorConfiguration,
    });
  const evaluationOperations = createEvaluationOperations({
    evaluations,
    recordAuthorityAttribution,
  });
  const concurrencyOperations = createCodexExecutionConcurrencyOperations({
    codexExecutionConcurrency,
  });
  const apiOperations = createApiOperations({
    analytics: { read: evaluations.readAnalytics },
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
        onboardingTokens,
        operations: onboardingOperations,
      })
    );
  const handleMcp = createMcpRoute({
    evaluations,
    onboardingOperations,
    recordMcpOperation,
    repositories,
    repositoryGuidance,
  });
  const requireMcpOrigin = createMcpOriginHook(browserOrigin);
  /** @type {Record<string, (request: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) => unknown>} */
  const standardOperationHandlers = {
    ...apiOperations,
    ...concurrencyOperations,
    ...createForgejoConnectionRoute({
      forgejoConnections,
    }),
    ...createGitHubConnectionRoute({
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
    routes.addHook("onError", (request, reply, error, done) => {
      void reply;
      const fastifyError = /** @type {any} */ (error);
      if (fastifyError.validation) {
        recordBrowserSessionBoundaryFailure(
          request,
          canonicalFastifyValidationError(request, fastifyError.validation),
          recordAuthorityAttribution,
        );
      } else if (fastifyError.code?.startsWith("FST_ERR_CTP_")) {
        recordBrowserSessionBoundaryFailure(
          request,
          { code: "request_malformed" },
          recordAuthorityAttribution,
        );
      }
      done();
    });
    routes.addHook(
      "onRequest",
      createFastifyProductHook({
        browserOrigin,
        browserSessions,
        implementerTokens,
        onboardingTokens,
        readDurableCoreStatus,
        recordAuthorityAttribution,
        requestSecurity,
        runProductRequest,
      }),
    );
    routes.setNotFoundHandler((request, reply) => {
      void request;
      writeError(reply, 404, "not_found", "Resource was not found");
    });
    routes.get("/health/live", () => ({ status: "live" }));
    routes.get("/health/ready", (request, reply) => {
      void request;
      const status = readDurableCoreStatus();
      return status.status === "ready"
        ? { status: "ready" }
        : reply.code(503).send(status);
    });
    routes.get(
      "/",
      { schema: { hide: true, security: [] } },
      (request, reply) =>
        handleBrowserPage(request, reply, requestUrl(request)),
    );
    routes.get(
      "/assets/*",
      {
        schema: {
          hide: true,
          querystring: {
            additionalProperties: false,
            properties: {},
            type: "object",
          },
          security: [],
        },
      },
      (request, reply) =>
        handleBrowserAsset(request, reply, requestUrl(request)),
    );
    routes.post(
      "/mcp/v1",
      {
        onRequest: requireMcpOrigin,
        schema: {
          body: {},
          hide: true,
          querystring: {
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
      method: routes.supportedMethods.filter((method) => method !== "POST"),
      onRequest: [requireMcpOrigin, rejectMcpMethod],
      schema: {
        hide: true,
        security: [{ implementer_token: [] }, { onboarding_token: [] }],
      },
      url: "/mcp/v1",
    });
    const githubCallbackValidationError =
      createGitHubCallbackValidationErrorHandler(githubConnections);
    registerApiRoutes(routes, operationHandlers, {
      completeGitHubAppInstallation: githubCallbackValidationError,
      completeGitHubAppManifest: githubCallbackValidationError,
    });
  });
  return server;
}
