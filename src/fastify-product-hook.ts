import {
  recordBrowserSessionBoundaryFailure,
  rejectOperatorLoginCredentials,
} from "./browser-session-route.ts";
import { requireCodedError } from "./coded-error.ts";
import {
  allowedSecuritySchemes,
  notReadyMessage,
  requestUrl,
} from "./fastify-listener.ts";
import {
  authenticationFailureStatus,
  bearerToken,
  browserMutationFailureStatus,
  hasUrlToken,
  isProductSurface,
  requireBrowserMutation,
  requireProductAuthority,
  sessionSecret,
} from "./http-request.ts";
import { writeError } from "./http-response.ts";

const JSON_TYPE = "application/json";

export function createFastifyProductHook({
  browserOrigin,
  browserSessions,
  implementerTokens,
  onboardingTokens,
  readDurableCoreStatus,
  recordAuthorityAttribution,
  requestSecurity,
  runProductRequest,
}: any): (
  request: import("fastify").FastifyRequest,
  reply: import("fastify").FastifyReply,
  done: (error?: Error) => void,
) => void {
  return (request, reply, done) => {
    const productRequest = request as any;
    const url = requestUrl(request);
    const path = url.pathname;
    runProductRequest(path, () => {
      if (
        request.method === "GET" &&
        (path === "/health/live" || path === "/health/ready")
      ) {
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
      const schemes = allowedSecuritySchemes(request);
      try {
        if (hasUrlToken(url)) {
          throw Object.assign(new Error("Machine authentication is invalid"), {
            code: "authentication_invalid",
          });
        }
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
          const scheme = (
            {
              machine: "implementer_token",
              onboarding: "onboarding_token",
              operator: "browser_session",
            } as Record<string, string>
          )[productRequest.authority];
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
          productRequest.browserSessionSecret =
            productRequest.authority === "operator"
              ? sessionSecret(request)
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
            hasUrlToken(url) || request.headers.authorization !== undefined
              ? "implementer_token"
              : "browser_session",
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
        request.routeOptions.schema?.operationId === "loginOperator" &&
        rejectOperatorLoginCredentials(
          request,
          reply,
          implementerTokens,
          recordAuthorityAttribution,
        )
      ) {
        return;
      }
      if (
        productRequest.authority === "operator" &&
        request.routeOptions.schema?.security?.some(
          (security: Record<string, unknown>) => "browser_session" in security,
        ) &&
        ["DELETE", "PATCH", "POST", "PUT"].includes(request.method)
      ) {
        try {
          requireBrowserMutation(
            browserSessions,
            request,
            browserOrigin,
            productRequest.browserSessionSecret,
          );
        } catch (error) {
          const failure = requireCodedError(error);
          recordBrowserSessionBoundaryFailure(
            request,
            failure,
            recordAuthorityAttribution,
          );
          writeError(
            reply,
            browserMutationFailureStatus(failure.code),
            failure.code,
            failure.message,
          );
          return;
        }
      }
      if (
        path !== "/mcp/v1" &&
        request.routeOptions.schema?.body !== undefined &&
        request.headers["content-type"] !== JSON_TYPE
      ) {
        recordBrowserSessionBoundaryFailure(
          request,
          { code: "request_malformed" },
          recordAuthorityAttribution,
        );
        writeError(reply, 400, "request_malformed", "Request is malformed");
        return;
      }
      if (request.routeOptions.schema?.body === undefined) {
        delete request.headers["content-type"];
      }
      done();
    });
  };
}
