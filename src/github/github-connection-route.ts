import { writeBrowserJsonMutation } from "../api-mutation.ts";
import { requireCodedError } from "../coded-error.ts";
import { isUnavailableError } from "../http-request.ts";
import { writeError, writeJson, writeStatus } from "../http-response.ts";

function redirectCallbackFailure(
  response: import("fastify").FastifyReply,
  error: unknown,
  githubConnections: ReturnType<
    typeof import("./github-connection.ts").createGitHubConnectionService
  >,
) {
  const failure = requireCodedError(error);
  const receipt = githubConnections.recordCallbackFailure(failure);
  writeStatus(response, 303, {
    location: `/?view=repositories&github_connection_error=${receipt}`,
  });
}

export function createGitHubCallbackValidationErrorHandler(
  githubConnections: ReturnType<
    typeof import("./github-connection.ts").createGitHubConnectionService
  >,
) {
  return function handleGitHubCallbackValidationError(
    error: any,
    request: import("fastify").FastifyRequest,
    response: import("fastify").FastifyReply,
  ) {
    if (!error.validation) {
      throw error;
    }
    const installation =
      request.routeOptions.schema?.operationId ===
      "completeGitHubAppInstallation";
    redirectCallbackFailure(
      response,
      Object.assign(
        new Error(
          installation
            ? "GitHub App installation callback is invalid"
            : "GitHub App Manifest callback is invalid",
        ),
        {
          code: installation
            ? "github_installation_callback_invalid"
            : "github_manifest_callback_invalid",
        },
      ),
      githubConnections,
    );
  };
}

export function createGitHubConnectionRoute({
  githubConnections,
}: {
  githubConnections: ReturnType<
    typeof import("./github-connection.ts").createGitHubConnectionService
  >;
}) {
  return {
    getGitHubConnection(
      request: import("fastify").FastifyRequest,
      response: import("fastify").FastifyReply,
    ) {
      void request;
      writeJson(response, 200, githubConnections.read());
    },
    startGitHubAppManifest(
      request: import("fastify").FastifyRequest,
      response: import("fastify").FastifyReply,
    ) {
      return writeBrowserJsonMutation(request, response, {
        failureCode: "github_manifest_start_failed",
        mutate: () => githubConnections.start(),
        statusFor: (code, error) =>
          code === "github_connection_conflict"
            ? 409
            : isUnavailableError(error)
              ? 503
              : 422,
        unexpectedMessage: "GitHub App Manifest flow could not start",
      });
    },
    retireGitHubConnection(
      request: import("fastify").FastifyRequest,
      response: import("fastify").FastifyReply,
    ) {
      return writeBrowserJsonMutation(request, response, {
        failureCode: "github_connection_lifecycle_failed",
        mutate: (body) => githubConnections.retire(body),
        statusFor: (code, error) =>
          code === "github_connection_not_found"
            ? 404
            : code === "github_connection_repositories_active"
              ? 409
              : isUnavailableError(error)
                ? 503
                : 422,
        unexpectedMessage: "GitHub Connection retirement failed",
      });
    },
    deleteNeverUsedGitHubConnection(
      request: import("fastify").FastifyRequest,
      response: import("fastify").FastifyReply,
    ) {
      return writeBrowserJsonMutation(request, response, {
        failureCode: "github_connection_delete_failed",
        mutate: () => {
          githubConnections.remove();
          return null;
        },
        statusFor: (code, error) =>
          code === "github_connection_not_found"
            ? 404
            : code === "github_connection_delete_unsupported"
              ? 409
              : isUnavailableError(error)
                ? 503
                : 422,
        successStatus: 200,
        unexpectedMessage: "GitHub Connection deletion failed",
      });
    },
    reactivateGitHubConnection(
      request: import("fastify").FastifyRequest,
      response: import("fastify").FastifyReply,
    ) {
      return writeBrowserJsonMutation(request, response, {
        failureCode: "github_connection_reactivation_failed",
        mutate: (body) => githubConnections.reactivate(body),
        statusFor: (code, error) =>
          code === "github_connection_not_found"
            ? 404
            : code === "github_connection_reactivation_unsupported"
              ? 409
              : isUnavailableError(error)
                ? 503
                : 422,
        unexpectedMessage: "GitHub Connection reactivation failed",
      });
    },
    selectGitHubRepositories(
      request: import("fastify").FastifyRequest,
      response: import("fastify").FastifyReply,
    ) {
      return writeBrowserJsonMutation(request, response, {
        failureCode: "github_repository_selection_failed",
        mutate: (body) => githubConnections.selectRepositories(body),
        statusFor: (code, error) =>
          code === "github_connection_not_found" ||
          code === "github_repository_identity_conflict"
            ? 409
            : isUnavailableError(error) ||
                code === "github_api_unavailable" ||
                code === "github_api_transient_failure" ||
                code === "github_git_verification_failed" ||
                code === "github_private_git_read_failed"
              ? 503
              : 422,
        successStatus: 201,
        unexpectedMessage: "GitHub Repository selection failed",
      });
    },
    rotateGitHubConnectionCredentials(
      request: import("fastify").FastifyRequest,
      response: import("fastify").FastifyReply,
    ) {
      return writeBrowserJsonMutation(request, response, {
        failureCode: "github_connection_rotation_failed",
        mutate: (body) => githubConnections.rotate(body),
        statusFor: (code, error) =>
          code === "github_connection_not_found"
            ? 404
            : code === "github_connection_rotation_conflict"
              ? 409
              : isUnavailableError(error) ||
                  code === "github_api_unavailable" ||
                  code === "github_api_transient_failure" ||
                  code === "github_git_verification_failed" ||
                  code === "github_private_git_read_failed"
                ? 503
                : 422,
        unexpectedMessage: "GitHub App credential rotation failed",
      });
    },
    consumeGitHubCallbackFailure(
      request: import("fastify").FastifyRequest,
      response: import("fastify").FastifyReply,
    ) {
      try {
        const query = request.query as { receipt?: string };
        writeJson(
          response,
          200,
          githubConnections.consumeCallbackFailure(query.receipt ?? ""),
        );
      } catch (error) {
        const failure = requireCodedError(error);
        writeError(response, 400, failure.code, failure.message);
      }
    },
    async completeGitHubAppManifest(
      request: import("fastify").FastifyRequest,
      response: import("fastify").FastifyReply,
    ) {
      try {
        const query = request.query as { code?: string; state?: string };
        const location = await githubConnections.completeManifest({
          code: query.code ?? "",
          state: query.state ?? "",
        });
        writeStatus(response, 303, { location });
      } catch (error) {
        redirectCallbackFailure(response, error, githubConnections);
      }
    },
    async completeGitHubAppInstallation(
      request: import("fastify").FastifyRequest,
      response: import("fastify").FastifyReply,
    ) {
      try {
        const query = request.query as {
          installation_id?: string;
          setup_action?: string;
          state?: string;
        };
        if (query.setup_action !== "install") {
          throw Object.assign(
            new Error("GitHub App installation callback is invalid"),
            { code: "github_installation_callback_invalid" },
          );
        }
        await githubConnections.completeInstallation({
          installationId: query.installation_id ?? "",
          state: query.state ?? "",
        });
        writeStatus(response, 303, {
          location: "/?view=repositories&github_connection=connected",
        });
      } catch (error) {
        redirectCallbackFailure(response, error, githubConnections);
      }
    },
  };
}
