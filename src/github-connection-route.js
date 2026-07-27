import { writeBrowserJsonMutation } from "./api-mutation.js";
import { requireCodedError } from "./coded-error.js";
import {
  assertAllowedQueryParameters,
  isUnavailableError,
} from "./http-request.js";
import { writeError, writeJson } from "./http-response.js";

/**
 * @param {{
 *   browserOrigin: string,
 *   browserSessions: ReturnType<typeof import("./browser-session.js").createBrowserSessionService>,
 *   githubConnections: ReturnType<typeof import("./github-connection.js").createGitHubConnectionService>
 * }} dependencies
 */
export function createGitHubConnectionRoute({
  browserOrigin,
  browserSessions,
  githubConnections,
}) {
  /**
   * @param {import("node:http").IncomingMessage} request
   * @param {import("node:http").ServerResponse} response
   * @param {URL} requestUrl
   * @param {"callback" | "machine" | "operator" | undefined} authority
   */
  return async function handleGitHubConnection(
    request,
    response,
    requestUrl,
    authority,
  ) {
    const path = requestUrl.pathname;
    const { method } = request;
    if (!path.startsWith("/api/v1/github-connections")) {
      return false;
    }
    if (
      method === "GET" &&
      path === "/api/v1/github-connections/manifest/callback"
    ) {
      try {
        assertAllowedQueryParameters(requestUrl, new Set(["code", "state"]));
        const location = await githubConnections.completeManifest({
          code: requestUrl.searchParams.get("code") ?? "",
          state: requestUrl.searchParams.get("state") ?? "",
        });
        response.writeHead(303, { location });
        response.end();
      } catch (error) {
        const failure = requireCodedError(error);
        writeError(
          response,
          failure.code === "request_malformed"
            ? 400
            : isUnavailableError(error)
              ? 503
              : 422,
          failure.code,
          failure.message,
        );
      }
      return true;
    }
    if (method === "GET" && path === "/api/v1/github-connections/setup") {
      try {
        assertAllowedQueryParameters(
          requestUrl,
          new Set(["installation_id", "setup_action", "state"]),
        );
        if (requestUrl.searchParams.get("setup_action") !== "install") {
          throw Object.assign(
            new Error("GitHub App installation callback is invalid"),
            { code: "github_installation_callback_invalid" },
          );
        }
        await githubConnections.completeInstallation({
          installationId: requestUrl.searchParams.get("installation_id") ?? "",
          state: requestUrl.searchParams.get("state") ?? "",
        });
        response.writeHead(303, {
          location: "/?view=repositories&github_connection=connected",
        });
        response.end();
      } catch (error) {
        const failure = requireCodedError(error);
        writeError(
          response,
          failure.code === "request_malformed"
            ? 400
            : failure.code === "github_connection_conflict"
              ? 409
              : isUnavailableError(error)
                ? 503
                : 422,
          failure.code,
          failure.message,
        );
      }
      return true;
    }
    try {
      assertAllowedQueryParameters(requestUrl, new Set());
    } catch (error) {
      const failure = requireCodedError(error);
      writeError(response, 400, failure.code, failure.message);
      return true;
    }
    if (
      method === "GET" &&
      path === "/api/v1/github-connections" &&
      authority === "operator"
    ) {
      writeJson(response, 200, githubConnections.read());
      return true;
    }
    if (
      method === "POST" &&
      path === "/api/v1/github-connections/manifest" &&
      authority === "operator"
    ) {
      await writeBrowserJsonMutation(request, response, {
        browserOrigin,
        browserSessions,
        failureCode: "github_manifest_start_failed",
        mutate: (body) => {
          if (
            !body ||
            Array.isArray(body) ||
            typeof body !== "object" ||
            Object.keys(body).length !== 0
          ) {
            throw Object.assign(new Error("request_malformed"), {
              code: "request_malformed",
            });
          }
          return githubConnections.start();
        },
        requestUrl,
        statusFor: (code, error) =>
          code === "github_connection_conflict"
            ? 409
            : isUnavailableError(error)
              ? 503
              : 422,
        unexpectedMessage: "GitHub App Manifest flow could not start",
      });
      return true;
    }
    return false;
  };
}
