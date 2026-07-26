import {
  assertNoMixedCredentials,
  authenticationFailureMessage,
  authenticationFailureStatus,
  sessionSecret,
} from "./http-request.js";
import {
  browserView,
  loginPage,
  operatorPage,
  safeInternalDestination,
} from "./browser-pages.js";
import { writeError, writeHtml } from "./http-response.js";

export function createBrowserPageRoute({
  browserSessions,
  implementerTokens,
  recordAuthorityAttribution,
}) {
  return function handleBrowserPage(request, response, requestUrl) {
    if (request.method !== "GET" || requestUrl.pathname !== "/") {
      return false;
    }
    if (request.headers.authorization !== undefined) {
      try {
        assertNoMixedCredentials(request);
        const token = request.headers.authorization.match(
          /^Bearer ([A-Za-z0-9_-]{43})$/,
        )?.[1];
        if (!implementerTokens.authenticate(token)) {
          throw Object.assign(new Error("Machine authentication is invalid"), {
            code: "authentication_invalid",
          });
        }
        recordAuthorityAttribution({
          action: "authentication",
          channel: "implementer_token",
          outcome: "success",
        });
        recordAuthorityAttribution({
          action: "authorization",
          channel: "implementer_token",
          errorCode: "authorization_forbidden",
          outcome: "forbidden",
        });
        writeError(
          response,
          403,
          "authorization_forbidden",
          "Machine access is forbidden",
        );
      } catch (error) {
        recordAuthorityAttribution({
          action: "authentication",
          channel: "implementer_token",
          errorCode: error.code ?? "authentication_unavailable",
          outcome: "failure",
        });
        writeError(
          response,
          authenticationFailureStatus(error.code),
          error.code ?? "authentication_unavailable",
          error.message ?? authenticationFailureMessage(error.code),
        );
      }
      return true;
    }
    if (!browserSessions.isBootstrapped()) {
      writeHtml(
        response,
        '<main><p role="status">Operator bootstrap required</p></main>',
      );
      return true;
    }
    let view;
    try {
      view = browserView(requestUrl);
    } catch (error) {
      writeError(response, 404, error.code, error.message);
      return true;
    }
    try {
      assertNoMixedCredentials(request);
      if (browserSessions.authenticate(sessionSecret(request))) {
        recordAuthorityAttribution({
          action: "authentication",
          channel: "browser_session",
          outcome: "success",
        });
        writeHtml(response, operatorPage({ view }));
      } else {
        if (sessionSecret(request) !== undefined) {
          recordAuthorityAttribution({
            action: "authentication",
            channel: "browser_session",
            errorCode: "authentication_required",
            outcome: "failure",
          });
        }
        writeHtml(
          response,
          loginPage(
            safeInternalDestination(requestUrl.searchParams.get("return_to")),
          ),
        );
      }
    } catch (error) {
      recordAuthorityAttribution({
        action: "authentication",
        channel: "browser_session",
        errorCode: error.code ?? "authentication_unavailable",
        outcome: "failure",
      });
      writeError(
        response,
        authenticationFailureStatus(error.code),
        error.code ?? "authentication_unavailable",
        error.message ?? authenticationFailureMessage(error.code),
      );
    }
    return true;
  };
}
