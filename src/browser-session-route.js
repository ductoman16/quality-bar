import {
  assertAllowedQueryParameters,
  assertNoMixedCredentials,
  authenticationFailureStatus,
  browserMutationFailureStatus,
  clearedSessionCookies,
  csrfCookie,
  implementerTokenFailureStatus,
  passwordMutationFailureStatus,
  readImplementerTokenRequest,
  readLoginRequest,
  readPasswordChangeRequest,
  readSessionRevocationRequest,
  requireBrowserMutationWithQuery,
  sessionCookie,
} from "./http-request.js";
import { writeMachineOperatorAccessDenial } from "./api-authorization.js";
import { requireCodedError } from "./coded-error.js";
import { writeEmpty, writeError, writeJson } from "./http-response.js";

const BROWSER_SESSION_ROUTES = new Map([
  ["/api/v1/session/login", "login"],
  ["/api/v1/session/logout", "session_logout"],
  ["/api/v1/session/activity", "session_activity"],
  ["/api/v1/session/password", "password_change"],
  ["/api/v1/sessions/revoke", "session_revoke_all"],
  ["/api/v1/implementer-token", "implementer_token_create"],
  ["/api/v1/implementer-token/rotate", "implementer_token_rotate"],
  ["/api/v1/implementer-token/revoke", "implementer_token_revoke"],
]);

/**
 * @typedef {{
 *   action: string,
 *   channel: string,
 *   errorCode?: string,
 *   outcome: string
 * }} AttributionEvent
 */
/** @param {ReturnType<typeof requireCodedError>} error */
function loginRetryAfterSeconds(error) {
  if (
    !("retryAfterSeconds" in error) ||
    typeof error.retryAfterSeconds !== "number"
  ) {
    throw new TypeError(
      "login_throttled error must provide retryAfterSeconds",
      {
        cause: error,
      },
    );
  }
  return error.retryAfterSeconds;
}

/**
 * @param {import("node:http").ServerResponse} response
 * @param {ReturnType<typeof requireCodedError>} error
 * @param {(code: string) => number} status
 */
function writeMalformedOrAuthenticationError(response, error, status) {
  if (error.message === "request_malformed") {
    writeError(response, 400, "request_malformed", "Request is malformed");
    return;
  }
  writeError(response, status(error.code), error.code, error.message);
}

/**
 * @param {{
 *   browserOrigin: string,
 *   browserSessions: ReturnType<typeof import("./browser-session.js").createBrowserSessionService>,
 *   implementerTokens: ReturnType<typeof import("./implementer-token.js").createImplementerTokenService>,
 *   recordAuthorityAttribution: (event: AttributionEvent) => void,
 *   secureBrowserCookie: boolean
 * }} dependencies
 */
export function createBrowserSessionRoute({
  browserOrigin,
  browserSessions,
  implementerTokens,
  recordAuthorityAttribution,
  secureBrowserCookie,
}) {
  /**
   * @param {import("node:http").IncomingMessage} request
   * @param {import("node:http").ServerResponse} response
   * @param {URL} requestUrl
   */
  return async function handleBrowserSession(request, response, requestUrl) {
    const { method } = request;
    const path = requestUrl.pathname;
    const route = method === "POST" ? BROWSER_SESSION_ROUTES.get(path) : null;
    if (!route) {
      return false;
    }
    if (
      request.headers.authorization !== undefined &&
      request.headers.cookie === undefined
    ) {
      writeMachineOperatorAccessDenial(
        request,
        response,
        implementerTokens,
        recordAuthorityAttribution,
      );
      return true;
    }
    if (route === "login") {
      try {
        assertAllowedQueryParameters(requestUrl, new Set());
        assertNoMixedCredentials(request);
        const { password } = await readLoginRequest(request);
        const { csrfToken, secret } = browserSessions.login(password);
        writeEmpty(response, {
          "set-cookie": [
            sessionCookie(secret, secureBrowserCookie),
            csrfCookie(csrfToken, secureBrowserCookie),
          ],
        });
      } catch (error) {
        const failure = requireCodedError(error);
        if (failure.code === "authentication_ambiguous") {
          recordAuthorityAttribution({
            action: "authentication",
            channel: "browser_session",
            errorCode: failure.code,
            outcome: "failure",
          });
        }
        if (failure.message === "request_malformed") {
          writeError(
            response,
            400,
            "request_malformed",
            "Request is malformed",
          );
        } else {
          writeError(
            response,
            authenticationFailureStatus(failure.code),
            failure.code,
            failure.message,
            failure.code === "login_throttled"
              ? { "retry-after": String(loginRetryAfterSeconds(failure)) }
              : undefined,
          );
        }
      }
      return true;
    }
    if (route === "session_logout") {
      try {
        browserSessions.logout(
          requireBrowserMutationWithQuery(
            browserSessions,
            request,
            browserOrigin,
            requestUrl,
          ),
        );
        writeEmpty(response, {
          "set-cookie": clearedSessionCookies(secureBrowserCookie),
        });
      } catch (error) {
        const failure = requireCodedError(error);
        recordAuthorityAttribution({
          action: "session_logout",
          channel: "browser_session",
          errorCode: failure.code,
          outcome: "failure",
        });
        writeMalformedOrAuthenticationError(
          response,
          failure,
          browserMutationFailureStatus,
        );
      }
      return true;
    }
    if (route === "session_activity") {
      try {
        const secret = requireBrowserMutationWithQuery(
          browserSessions,
          request,
          browserOrigin,
          requestUrl,
        );
        if (
          !browserSessions.touch(
            secret,
            typeof request.headers["x-quality-bar-csrf"] === "string"
              ? request.headers["x-quality-bar-csrf"]
              : undefined,
          )
        ) {
          throw Object.assign(new Error("Browser session is required"), {
            code: "authentication_required",
          });
        }
        writeEmpty(response);
      } catch (error) {
        const failure = requireCodedError(error);
        recordAuthorityAttribution({
          action: "session_activity",
          channel: "browser_session",
          errorCode: failure.code,
          outcome: "failure",
        });
        writeMalformedOrAuthenticationError(
          response,
          failure,
          browserMutationFailureStatus,
        );
      }
      return true;
    }
    if (route === "password_change") {
      try {
        requireBrowserMutationWithQuery(
          browserSessions,
          request,
          browserOrigin,
          requestUrl,
        );
        const { current_password, new_password } =
          await readPasswordChangeRequest(request);
        browserSessions.changePassword(current_password, new_password);
        writeEmpty(response, {
          "set-cookie": clearedSessionCookies(secureBrowserCookie),
        });
      } catch (error) {
        const failure = requireCodedError(error);
        recordAuthorityAttribution({
          action: "password_change",
          channel: "browser_session",
          errorCode: failure.code,
          outcome: "failure",
        });
        writeMalformedOrAuthenticationError(response, failure, (code) =>
          browserMutationFailureStatus(code) === 403
            ? 403
            : passwordMutationFailureStatus(code),
        );
      }
      return true;
    }
    if (route === "session_revoke_all") {
      try {
        requireBrowserMutationWithQuery(
          browserSessions,
          request,
          browserOrigin,
          requestUrl,
        );
        const { confirmation, password } =
          await readSessionRevocationRequest(request);
        if (confirmation !== "REVOKE ALL SESSIONS") {
          throw Object.assign(
            new Error("Global browser-session revocation must be confirmed"),
            { code: "session_revocation_confirmation_invalid" },
          );
        }
        browserSessions.revokeAll(password);
        writeEmpty(response, {
          "set-cookie": clearedSessionCookies(secureBrowserCookie),
        });
      } catch (error) {
        const failure = requireCodedError(error);
        recordAuthorityAttribution({
          action: "session_revoke_all",
          channel: "browser_session",
          errorCode: failure.code,
          outcome: "failure",
        });
        writeMalformedOrAuthenticationError(response, failure, (code) =>
          browserMutationFailureStatus(code) === 403
            ? 403
            : passwordMutationFailureStatus(code),
        );
      }
      return true;
    }
    if (route.startsWith("implementer_token_")) {
      try {
        requireBrowserMutationWithQuery(
          browserSessions,
          request,
          browserOrigin,
          requestUrl,
        );
        const { password } = await readImplementerTokenRequest(request);
        if (route === "implementer_token_revoke") {
          implementerTokens.revoke(password);
          writeEmpty(response);
        } else {
          const token =
            route === "implementer_token_rotate"
              ? implementerTokens.rotate(password)
              : implementerTokens.create(password);
          writeJson(
            response,
            route === "implementer_token_rotate" ? 200 : 201,
            {
              token,
            },
          );
        }
      } catch (error) {
        const failure = requireCodedError(error);
        recordAuthorityAttribution({
          action: route,
          channel: "browser_session",
          errorCode: failure.code,
          outcome: "failure",
        });
        writeMalformedOrAuthenticationError(response, failure, (code) =>
          browserMutationFailureStatus(code) === 403
            ? 403
            : implementerTokenFailureStatus(code),
        );
      }
      return true;
    }
    return false;
  };
}
