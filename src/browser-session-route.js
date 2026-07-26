import {
  assertAllowedQueryParameters,
  assertNoMixedCredentials,
  authenticationFailureMessage,
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
import { writeEmpty, writeError, writeJson } from "./http-response.js";

function writeMalformedOrAuthenticationError(response, error, status) {
  if (error.message === "request_malformed") {
    writeError(response, 400, "request_malformed", "Request is malformed");
    return;
  }
  writeError(
    response,
    status(error.code),
    error.code ?? "authentication_unavailable",
    error.message ?? authenticationFailureMessage(error.code),
  );
}

export function createBrowserSessionRoute({
  browserOrigin,
  browserSessions,
  implementerTokens,
  recordAuthorityAttribution,
  secureBrowserCookie,
}) {
  return async function handleBrowserSession(request, response, requestUrl) {
    const { method } = request;
    const path = requestUrl.pathname;
    if (method === "POST" && path === "/api/v1/session/login") {
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
        if (error.code === "authentication_ambiguous") {
          recordAuthorityAttribution({
            action: "authentication",
            channel: "browser_session",
            errorCode: error.code,
            outcome: "failure",
          });
        }
        if (error.message === "request_malformed") {
          writeError(
            response,
            400,
            "request_malformed",
            "Request is malformed",
          );
        } else {
          writeError(
            response,
            authenticationFailureStatus(error.code),
            error.code ?? "authentication_unavailable",
            error.message ?? authenticationFailureMessage(error.code),
            error.code === "login_throttled"
              ? { "retry-after": String(error.retryAfterSeconds) }
              : undefined,
          );
        }
      }
      return true;
    }
    if (method === "POST" && path === "/api/v1/session/logout") {
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
        recordAuthorityAttribution({
          action: "session_logout",
          channel: "browser_session",
          errorCode: error.code ?? "authentication_unavailable",
          outcome: "failure",
        });
        writeMalformedOrAuthenticationError(
          response,
          error,
          browserMutationFailureStatus,
        );
      }
      return true;
    }
    if (method === "POST" && path === "/api/v1/session/activity") {
      try {
        const secret = requireBrowserMutationWithQuery(
          browserSessions,
          request,
          browserOrigin,
          requestUrl,
        );
        if (
          !browserSessions.touch(secret, request.headers["x-quality-bar-csrf"])
        ) {
          throw Object.assign(new Error("Browser session is required"), {
            code: "authentication_required",
          });
        }
        writeEmpty(response);
      } catch (error) {
        recordAuthorityAttribution({
          action: "session_activity",
          channel: "browser_session",
          errorCode: error.code ?? "authentication_unavailable",
          outcome: "failure",
        });
        writeMalformedOrAuthenticationError(
          response,
          error,
          browserMutationFailureStatus,
        );
      }
      return true;
    }
    if (method === "POST" && path === "/api/v1/session/password") {
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
        recordAuthorityAttribution({
          action: "password_change",
          channel: "browser_session",
          errorCode: error.code ?? "authentication_unavailable",
          outcome: "failure",
        });
        writeMalformedOrAuthenticationError(response, error, (code) =>
          browserMutationFailureStatus(code) === 403
            ? 403
            : passwordMutationFailureStatus(code),
        );
      }
      return true;
    }
    if (method === "POST" && path === "/api/v1/sessions/revoke") {
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
        recordAuthorityAttribution({
          action: "session_revoke_all",
          channel: "browser_session",
          errorCode: error.code ?? "authentication_unavailable",
          outcome: "failure",
        });
        writeMalformedOrAuthenticationError(response, error, (code) =>
          browserMutationFailureStatus(code) === 403
            ? 403
            : passwordMutationFailureStatus(code),
        );
      }
      return true;
    }
    if (
      method === "POST" &&
      [
        "/api/v1/implementer-token",
        "/api/v1/implementer-token/rotate",
        "/api/v1/implementer-token/revoke",
      ].includes(path)
    ) {
      try {
        requireBrowserMutationWithQuery(
          browserSessions,
          request,
          browserOrigin,
          requestUrl,
        );
        const { password } = await readImplementerTokenRequest(request);
        if (path === "/api/v1/implementer-token/revoke") {
          implementerTokens.revoke(password);
          writeEmpty(response);
        } else {
          const token = path.endsWith("/rotate")
            ? implementerTokens.rotate(password)
            : implementerTokens.create(password);
          writeJson(response, path.endsWith("/rotate") ? 200 : 201, { token });
        }
      } catch (error) {
        recordAuthorityAttribution({
          action: path.endsWith("/rotate")
            ? "implementer_token_rotate"
            : path.endsWith("/revoke")
              ? "implementer_token_revoke"
              : "implementer_token_create",
          channel: "browser_session",
          errorCode: error.code ?? "authentication_unavailable",
          outcome: "failure",
        });
        writeMalformedOrAuthenticationError(response, error, (code) =>
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
