import {
  assertNoMixedCredentials,
  authenticationFailureStatus,
  sessionSecret,
} from "./http-request.js";
import { writeMachineOperatorAccessDenial } from "./api-authorization.js";
import {
  browserView,
  loginPage,
  operatorPage,
  safeInternalDestination,
} from "./browser-pages.js";
import { requireCodedError } from "./coded-error.js";
import { writeError, writeHtml } from "./http-response.js";

/**
 * @typedef {{
 *   action: string,
 *   channel: string,
 *   errorCode?: string,
 *   outcome: string
 * }} AttributionEvent
 */
/**
 * @param {{
 *   browserSessions: ReturnType<typeof import("./browser-session.js").createBrowserSessionService>,
 *   implementerTokens: ReturnType<typeof import("./implementer-token.js").createImplementerTokenService>,
 *   recordAuthorityAttribution: (event: AttributionEvent) => void
 * }} dependencies
 */
export function createBrowserPageRoute({
  browserSessions,
  implementerTokens,
  recordAuthorityAttribution,
}) {
  /**
   * @param {import("node:http").IncomingMessage} request
   * @param {import("node:http").ServerResponse} response
   * @param {URL} requestUrl
   */
  return function handleBrowserPage(request, response, requestUrl) {
    if (request.method !== "GET" || requestUrl.pathname !== "/") {
      return false;
    }
    if (request.headers.authorization !== undefined) {
      writeMachineOperatorAccessDenial(
        request,
        response,
        implementerTokens,
        recordAuthorityAttribution,
      );
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
      const failure = requireCodedError(error);
      writeError(response, 404, failure.code, failure.message);
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
      const failure = requireCodedError(error);
      recordAuthorityAttribution({
        action: "authentication",
        channel: "browser_session",
        errorCode: failure.code,
        outcome: "failure",
      });
      writeError(
        response,
        authenticationFailureStatus(failure.code),
        failure.code,
        failure.message,
      );
    }
    return true;
  };
}
