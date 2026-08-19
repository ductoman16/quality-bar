import {
  assertNoMixedCredentials,
  authenticationFailureStatus,
  sessionSecret,
  themePreference,
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
        '<main><h1>Operator setup required</h1><p>Run this once from the Quality Bar repository root. It creates the required configuration and installation master-key files, bootstraps the operator password, provisions the persistent Codex login, and starts the service.</p><p>For a new installation, run the whole block in one shell. If the master-key file already exists, keep it: never generate a replacement for an installation that already has state.</p><pre><code>mkdir -p .quality-bar\nchmod 0700 .quality-bar\nprintf \'%s\\n\' \'QUALITY_BAR_EXTERNAL_ORIGIN=http://127.0.0.1:3000\' \'QUALITY_BAR_TRUSTED_PROXY_ADDRESSES=none\' &gt; .quality-bar/config.env\nif [ ! -s .quality-bar/quality-bar-master-key ]; then\n  openssl rand -base64 32 &gt; .quality-bar/quality-bar-master-key\nfi\nchmod 0400 .quality-bar/config.env .quality-bar/quality-bar-master-key\nexport QUALITY_BAR_CONFIG_FILE="$PWD/.quality-bar/config.env"\nexport QUALITY_BAR_MASTER_KEY_FILE="$PWD/.quality-bar/quality-bar-master-key"\nexport QUALITY_BAR_HTTP_PORT=3000\nif [ "$(uname -s)" = Linux ]; then\n  sudo chown 10001:10001 "$QUALITY_BAR_CONFIG_FILE" "$QUALITY_BAR_MASTER_KEY_FILE"\nfi\ndocker compose config --quiet\ndocker compose stop quality-bar\ndocker compose build quality-bar\ndocker compose run --rm --no-deps quality-bar node src/bootstrap-operator-password.js\ndocker compose run --rm --no-deps quality-bar codex login --device-auth\ndocker compose up --detach --wait\ncurl --fail http://127.0.0.1:3000/health/live</code></pre><p><code>config.env</code> must contain exactly these two lines:</p><pre><code>QUALITY_BAR_EXTERNAL_ORIGIN=http://127.0.0.1:3000\nQUALITY_BAR_TRUSTED_PROXY_ADDRESSES=none</code></pre><p>The master key is 32 random bytes encoded by <code>openssl rand -base64 32</code>; keep that file private and backed up, and do not regenerate it after the installation has state. If you change the HTTP port, use the same port in <code>QUALITY_BAR_EXTERNAL_ORIGIN</code>, <code>QUALITY_BAR_HTTP_PORT</code>, and the final <code>curl</code> URL.</p><p>The password bootstrap reads a password from the terminal, requires at least 15 characters, and takes no password argument or environment variable. The Codex login command starts device authentication; complete that sign-in before the final <code>docker compose up</code>.</p><p>The exports apply only to this shell. For later shells, put the same absolute paths in the repository <code>.env</code> file, preserving its existing <code>QUALITY_BAR_VERSION</code> line. Docker Desktop/macOS can skip the Linux-only <code>chown</code> line; the <code>0700</code> directory and <code>0400</code> files are still required.</p></main>',
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
    const theme = themePreference(request);
    try {
      assertNoMixedCredentials(request);
      if (browserSessions.authenticate(sessionSecret(request))) {
        recordAuthorityAttribution({
          action: "authentication",
          channel: "browser_session",
          outcome: "success",
        });
        writeHtml(
          response,
          operatorPage({
            evaluationId: requestUrl.searchParams.get("evaluation_id"),
            view,
          }),
          theme,
        );
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
          theme,
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
