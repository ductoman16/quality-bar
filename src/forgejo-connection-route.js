import { writeBrowserJsonMutation } from "./api-mutation.js";
import { isUnavailableError } from "./http-request.js";
import { writeJson } from "./http-response.js";

/** @param {{browserOrigin: string, browserSessions: any, forgejoConnections: {connect: (body: unknown) => Promise<unknown>, discover: (body: unknown) => Promise<unknown>, read: () => unknown, reactivate: (body: unknown) => Promise<unknown>, remove: () => void, retire: (body: unknown) => unknown, rotate: (body: unknown) => Promise<unknown>}}} dependencies */
export function createForgejoConnectionRoute({
  browserOrigin,
  browserSessions,
  forgejoConnections,
}) {
  return {
    /** @param {import("fastify").FastifyRequest} request @param {import("fastify").FastifyReply} response */
    getForgejoConnection(request, response) {
      void request;
      writeJson(response, 200, forgejoConnections.read());
    },
    /** @param {import("fastify").FastifyRequest} request @param {import("fastify").FastifyReply} response */
    verifyForgejoV16Connection(request, response) {
      return writeBrowserJsonMutation(request, response, {
        browserOrigin,
        browserSessions,
        failureCode: "forgejo_connection_failed",
        mutate: (body) => forgejoConnections.connect(body),
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
    },
    /** @param {import("fastify").FastifyRequest} request @param {import("fastify").FastifyReply} response */
    discoverForgejoV16Repositories(request, response) {
      return writeBrowserJsonMutation(request, response, {
        browserOrigin,
        browserSessions,
        failureCode: "forgejo_connection_discovery_failed",
        mutate: (body) => forgejoConnections.discover(body),
        statusFor: (...parameters) =>
          isUnavailableError(parameters[1]) ? 503 : 422,
        successStatus: 200,
        unexpectedMessage: "Forgejo Repository discovery failed",
      });
    },
    /** @param {import("fastify").FastifyRequest} request @param {import("fastify").FastifyReply} response */
    rotateForgejoConnectionPat(request, response) {
      return writeBrowserJsonMutation(request, response, {
        browserOrigin,
        browserSessions,
        failureCode: "forgejo_connection_rotation_failed",
        mutate: (body) => forgejoConnections.rotate(body),
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
    },
    /** @param {import("fastify").FastifyRequest} request @param {import("fastify").FastifyReply} response */
    deleteNeverUsedForgejoConnection(request, response) {
      return writeBrowserJsonMutation(request, response, {
        browserOrigin,
        browserSessions,
        failureCode: "forgejo_connection_delete_failed",
        mutate: (body) => {
          if (Object.keys(/** @type {object} */ (body)).length !== 0) {
            throw Object.assign(new Error("request_malformed"), {
              code: "request_malformed",
            });
          }
          forgejoConnections.remove();
          return null;
        },
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
    },
    /** @param {import("fastify").FastifyRequest} request @param {import("fastify").FastifyReply} response */
    retireForgejoConnection(request, response) {
      return writeBrowserJsonMutation(request, response, {
        browserOrigin,
        browserSessions,
        failureCode: "forgejo_connection_lifecycle_failed",
        mutate: (body) => forgejoConnections.retire(body),
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
    },
    /** @param {import("fastify").FastifyRequest} request @param {import("fastify").FastifyReply} response */
    reactivateForgejoConnection(request, response) {
      return writeBrowserJsonMutation(request, response, {
        browserOrigin,
        browserSessions,
        failureCode: "forgejo_connection_reactivation_failed",
        mutate: (body) => forgejoConnections.reactivate(body),
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
    },
  };
}
