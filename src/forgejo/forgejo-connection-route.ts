import { writeBrowserJsonMutation } from "../api-mutation.ts";
import { isUnavailableError } from "../http-request.ts";
import { writeJson } from "../http-response.ts";

export function createForgejoConnectionRoute({
  forgejoConnections,
}: {
  forgejoConnections: {
    connect: (body: unknown) => Promise<unknown>;
    discover: (body: unknown) => Promise<unknown>;
    read: () => unknown;
    reactivate: (body: unknown) => Promise<unknown>;
    remove: () => void;
    retire: (body: unknown) => unknown;
    rotate: (body: unknown) => Promise<unknown>;
  };
}) {
  return {
    getForgejoConnection(
      request: import("fastify").FastifyRequest,
      response: import("fastify").FastifyReply,
    ) {
      void request;
      writeJson(response, 200, forgejoConnections.read());
    },
    verifyForgejoConnection(
      request: import("fastify").FastifyRequest,
      response: import("fastify").FastifyReply,
    ) {
      return writeBrowserJsonMutation(request, response, {
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
    discoverForgejoRepositories(
      request: import("fastify").FastifyRequest,
      response: import("fastify").FastifyReply,
    ) {
      return writeBrowserJsonMutation(request, response, {
        failureCode: "forgejo_connection_discovery_failed",
        mutate: (body) => forgejoConnections.discover(body),
        statusFor: (...parameters) =>
          isUnavailableError(parameters[1]) ? 503 : 422,
        successStatus: 200,
        unexpectedMessage: "Forgejo Repository discovery failed",
      });
    },
    rotateForgejoConnectionPat(
      request: import("fastify").FastifyRequest,
      response: import("fastify").FastifyReply,
    ) {
      return writeBrowserJsonMutation(request, response, {
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
    deleteNeverUsedForgejoConnection(
      request: import("fastify").FastifyRequest,
      response: import("fastify").FastifyReply,
    ) {
      return writeBrowserJsonMutation(request, response, {
        failureCode: "forgejo_connection_delete_failed",
        mutate: () => {
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
    retireForgejoConnection(
      request: import("fastify").FastifyRequest,
      response: import("fastify").FastifyReply,
    ) {
      return writeBrowserJsonMutation(request, response, {
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
    reactivateForgejoConnection(
      request: import("fastify").FastifyRequest,
      response: import("fastify").FastifyReply,
    ) {
      return writeBrowserJsonMutation(request, response, {
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
