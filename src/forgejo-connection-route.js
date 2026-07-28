import { writeBrowserJsonMutation } from "./api-mutation.js";
import {
  assertAllowedQueryParameters,
  isUnavailableError,
} from "./http-request.js";
import { requireCodedError } from "./coded-error.js";
import { writeError, writeJson } from "./http-response.js";

/** @param {{browserOrigin: string, browserSessions: any, forgejoConnections: {connect: (body: unknown) => Promise<unknown>, discover: (body: unknown) => Promise<unknown>, read: () => unknown}}} dependencies */
export function createForgejoConnectionRoute({
  browserOrigin,
  browserSessions,
  forgejoConnections,
}) {
  return async function handleForgejoConnection(
    /** @type {import("node:http").IncomingMessage} */ request,
    /** @type {import("node:http").ServerResponse} */ response,
    /** @type {URL} */ requestUrl,
    /** @type {"callback" | "machine" | "operator" | undefined} */ authority,
  ) {
    const { method } = request;
    const path = requestUrl.pathname;
    if (!path.startsWith("/api/v1/forgejo-connections")) {
      return false;
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
      path === "/api/v1/forgejo-connections" &&
      authority === "operator"
    ) {
      writeJson(response, 200, forgejoConnections.read());
      return true;
    }
    if (
      method === "POST" &&
      path === "/api/v1/forgejo-connections/discover" &&
      authority === "operator"
    ) {
      await writeBrowserJsonMutation(request, response, {
        browserOrigin,
        browserSessions,
        failureCode: "forgejo_connection_discovery_failed",
        mutate: (body) => forgejoConnections.discover(body),
        requestUrl,
        statusFor: (...parameters) =>
          isUnavailableError(parameters[1]) ? 503 : 422,
        successStatus: 200,
        unexpectedMessage: "Forgejo Repository discovery failed",
      });
      return true;
    }
    if (
      method === "POST" &&
      path === "/api/v1/forgejo-connections" &&
      authority === "operator"
    ) {
      await writeBrowserJsonMutation(request, response, {
        browserOrigin,
        browserSessions,
        failureCode: "forgejo_connection_failed",
        mutate: (body) => forgejoConnections.connect(body),
        requestUrl,
        statusFor: (code, error) =>
          code === "forgejo_connection_conflict" ||
          code === "forgejo_repository_identity_conflict"
            ? 409
            : isUnavailableError(error)
              ? 503
              : 422,
        successStatus: 201,
        unexpectedMessage: "Forgejo Connection verification failed",
      });
      return true;
    }
    return false;
  };
}
