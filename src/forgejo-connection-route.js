import { writeBrowserJsonMutation } from "./api-mutation.js";
import {
  assertAllowedQueryParameters,
  isUnavailableError,
} from "./http-request.js";
import { requireCodedError } from "./coded-error.js";
import { writeError, writeJson } from "./http-response.js";

/** @param {{browserOrigin: string, browserSessions: any, forgejoConnections: {connect: (body: unknown) => Promise<unknown>, discover: (body: unknown) => Promise<unknown>, read: () => unknown, reactivate: (body: unknown) => Promise<unknown>, remove: () => void, retire: (body: unknown) => unknown, rotate: (body: unknown) => Promise<unknown>}}} dependencies */
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
      method === "PATCH" &&
      path === "/api/v1/forgejo-connections/lifecycle" &&
      authority === "operator"
    ) {
      await writeBrowserJsonMutation(request, response, {
        browserOrigin,
        browserSessions,
        failureCode: "forgejo_connection_lifecycle_failed",
        mutate: (body) => forgejoConnections.retire(body),
        requestUrl,
        statusFor: (code, error) =>
          code === "forgejo_connection_not_found"
            ? 404
            : code === "forgejo_connection_repositories_active" ||
                code === "forgejo_connection_lifecycle_conflict"
              ? 409
              : isUnavailableError(error)
                ? 503
                : 422,
        successStatus: 200,
        unexpectedMessage: "Forgejo Connection retirement failed",
      });
      return true;
    }
    if (
      method === "DELETE" &&
      path === "/api/v1/forgejo-connections/lifecycle" &&
      authority === "operator"
    ) {
      await writeBrowserJsonMutation(request, response, {
        browserOrigin,
        browserSessions,
        failureCode: "forgejo_connection_delete_failed",
        mutate: (body) => {
          if (
            !body ||
            Array.isArray(body) ||
            typeof body !== "object" ||
            Object.keys(body).length
          ) {
            throw Object.assign(new Error("request_malformed"), {
              code: "request_malformed",
            });
          }
          forgejoConnections.remove();
          return null;
        },
        requestUrl,
        statusFor: (code, error) =>
          code === "forgejo_connection_not_found"
            ? 404
            : code === "forgejo_connection_delete_unsupported" ||
                code === "forgejo_connection_lifecycle_conflict"
              ? 409
              : isUnavailableError(error)
                ? 503
                : 422,
        successStatus: 200,
        unexpectedMessage: "Forgejo Connection deletion failed",
      });
      return true;
    }
    if (
      method === "POST" &&
      path === "/api/v1/forgejo-connections/reactivate" &&
      authority === "operator"
    ) {
      await writeBrowserJsonMutation(request, response, {
        browserOrigin,
        browserSessions,
        failureCode: "forgejo_connection_reactivation_failed",
        mutate: (body) => forgejoConnections.reactivate(body),
        requestUrl,
        statusFor: (code, error) =>
          code === "forgejo_connection_not_found"
            ? 404
            : code === "forgejo_connection_reactivation_unsupported" ||
                code === "forgejo_connection_reactivation_conflict"
              ? 409
              : isUnavailableError(error)
                ? 503
                : 422,
        successStatus: 200,
        unexpectedMessage: "Forgejo Connection reactivation failed",
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
    if (
      method === "POST" &&
      path === "/api/v1/forgejo-connections/credential/rotate" &&
      authority === "operator"
    ) {
      await writeBrowserJsonMutation(request, response, {
        browserOrigin,
        browserSessions,
        failureCode: "forgejo_connection_rotation_failed",
        mutate: (body) => forgejoConnections.rotate(body),
        requestUrl,
        statusFor: (code, error) =>
          code === "forgejo_connection_not_found"
            ? 404
            : code === "forgejo_connection_rotation_conflict"
              ? 409
              : isUnavailableError(error)
                ? 503
                : 422,
        successStatus: 200,
        unexpectedMessage: "Forgejo PAT rotation failed",
      });
      return true;
    }
    return false;
  };
}
