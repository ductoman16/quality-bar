import { METHODS } from "node:http";
import { fileURLToPath } from "node:url";

import fastifyStatic from "@fastify/static";
import { createApiOperations } from "./api-route.ts";
import { createBrowserPageRoute } from "./browser-page-route.ts";
import {
  createBrowserSessionOperations,
  recordBrowserSessionBoundaryFailure,
} from "./browser-session-route.ts";
import { createCanonicalComponents } from "./canonical/schema.ts";
import { readCodexCapabilityCatalog } from "./codex/codex-capabilities.ts";
import { createCodexExecutionConcurrencyOperations } from "./codex/codex-execution-concurrency-route.ts";
import { createEvaluationOperations } from "./evaluation/evaluation-route.ts";
import { createForgejoConnectionRoute } from "./forgejo/forgejo-connection-route.ts";
import {
  createFastify,
  registerApiRoutes,
  requestUrl,
} from "./fastify-listener.ts";
import { createFastifyProductHook } from "./fastify-product-hook.ts";
import { canonicalFastifyValidationError } from "./fastify-validation-error.ts";
import { bearerToken } from "./http-request.ts";
import { writeError } from "./http-response.ts";
import {
  createGitHubCallbackValidationErrorHandler,
  createGitHubConnectionRoute,
} from "./github/github-connection-route.ts";
import {
  createMcpOriginHook,
  createMcpRoute,
  rejectMcpMethod,
} from "./mcp/mcp-route.ts";
import { createOnboardingApiOperations } from "./onboarding-api-route.ts";
import { createOnboardingOperations } from "./onboarding-operations.ts";
import { createProductRequestRunner } from "./product-request-runtime.ts";
import { createWaiverAdjudicatorConfigurationOperations } from "./waiver/waiver-adjudicator-configuration-route.ts";

export function createApplicationServer(
  dependencies: any,
): import("fastify").FastifyInstance {
  const {
    browserSessions,
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
  const evaluationOperations = createEvaluationOperations({ evaluations });
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
  const onboardingApiOperations = createOnboardingApiOperations({
    onboardingTokens,
    operations: onboardingOperations,
  }) as Record<
    string,
    (
      request: import("fastify").FastifyRequest,
      reply: import("fastify").FastifyReply,
    ) => unknown
  >;
  const handleMcp = createMcpRoute({
    evaluations,
    onboardingOperations,
    recordMcpOperation,
    repositories,
    repositoryGuidance,
  });
  const requireMcpOrigin = createMcpOriginHook(browserOrigin);
  const standardOperationHandlers: Record<
    string,
    (
      request: import("fastify").FastifyRequest,
      reply: import("fastify").FastifyReply,
    ) => unknown
  > = {
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
  const operationHandlers: Record<
    string,
    (
      request: import("fastify").FastifyRequest,
      reply: import("fastify").FastifyReply,
    ) => unknown
  > = {
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
      (request as any).authority === "onboarding"
        ? onboardingHandler(request, reply)
        : standardHandler(request, reply);
  }

  server.register(async (routes) => {
    routes.addHook("onError", (request, reply, error, done) => {
      void reply;
      const fastifyError = error as any;
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
    routes.register(fastifyStatic, {
      decorateReply: false,
      index: false,
      prefix: "/assets/",
      root: fileURLToPath(new URL("../dist/assets", import.meta.url)),
    });
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
    routes.get("/", { schema: { security: [] } }, (request, reply) =>
      handleBrowserPage(request, reply, requestUrl(request)),
    );
    routes.post(
      "/mcp/v1",
      {
        onRequest: requireMcpOrigin,
        schema: {
          body: {},
          querystring: {
            type: "object",
          },
          security: [{ implementer_token: [] }, { onboarding_token: [] }],
        },
      },
      (request, reply) => {
        const productRequest = request as any;
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
