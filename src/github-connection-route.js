import { writeBrowserJsonMutation } from "./api-mutation.js";
import { requireCodedError } from "./coded-error.js";
import { isUnavailableError } from "./http-request.js";
import { writeError, writeJson, writeStatus } from "./http-response.js";

/**
 * @param {import("fastify").FastifyReply} response
 * @param {unknown} error
 * @param {ReturnType<typeof import("./github-connection.js").createGitHubConnectionService>} githubConnections
 */
function redirectCallbackFailure(response, error, githubConnections) {
  const failure = requireCodedError(error);
  const receipt = githubConnections.recordCallbackFailure(failure);
  writeStatus(response, 303, {
    location: `/?view=repositories&github_connection_error=${receipt}`,
  });
}

/**
 * @param {import("fastify").FastifyRequest} request
 * @param {import("fastify").FastifyReply} response
 */
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
  return {
    /** @param {import("fastify").FastifyRequest} request @param {import("fastify").FastifyReply} response */
    getGitHubConnection(request, response) {
      void request;
      writeJson(response, 200, githubConnections.read());
    },
    /** @param {import("fastify").FastifyRequest} request @param {import("fastify").FastifyReply} response */
    startGitHubAppManifest(request, response) {
      return writeBrowserJsonMutation(request, response, {
        browserOrigin,
        browserSessions,
        failureCode: "github_manifest_start_failed",
        mutate: (body) => {
          if (Object.keys(/** @type {object} */ (body)).length !== 0) {
            throw Object.assign(new Error("request_malformed"), {
              code: "request_malformed",
            });
          }
          return githubConnections.start();
        },
        statusFor: (code, error) =>
          code === "github_connection_conflict"
            ? 409
            : isUnavailableError(error)
              ? 503
              : 422,
        unexpectedMessage: "GitHub App Manifest flow could not start",
      });
    },
    /** @param {import("fastify").FastifyRequest} request @param {import("fastify").FastifyReply} response */
    retireGitHubConnection(request, response) {
      return writeBrowserJsonMutation(request, response, {
        browserOrigin,
        browserSessions,
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
    /** @param {import("fastify").FastifyRequest} request @param {import("fastify").FastifyReply} response */
    deleteNeverUsedGitHubConnection(request, response) {
      return writeBrowserJsonMutation(request, response, {
        browserOrigin,
        browserSessions,
        failureCode: "github_connection_delete_failed",
        mutate: (body) => {
          if (Object.keys(/** @type {object} */ (body)).length !== 0) {
            throw Object.assign(new Error("request_malformed"), {
              code: "request_malformed",
            });
          }
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
    /** @param {import("fastify").FastifyRequest} request @param {import("fastify").FastifyReply} response */
    reactivateGitHubConnection(request, response) {
      return writeBrowserJsonMutation(request, response, {
        browserOrigin,
        browserSessions,
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
    /** @param {import("fastify").FastifyRequest} request @param {import("fastify").FastifyReply} response */
    selectGitHubRepositories(request, response) {
      return writeBrowserJsonMutation(request, response, {
        browserOrigin,
        browserSessions,
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
    /** @param {import("fastify").FastifyRequest} request @param {import("fastify").FastifyReply} response */
    rotateGitHubConnectionCredentials(request, response) {
      return writeBrowserJsonMutation(request, response, {
        browserOrigin,
        browserSessions,
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
    /** @param {import("fastify").FastifyRequest} request @param {import("fastify").FastifyReply} response */
    consumeGitHubCallbackFailure(request, response) {
      try {
        const query = /** @type {{receipt?: string}} */ (request.query);
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
    /** @param {import("fastify").FastifyRequest} request @param {import("fastify").FastifyReply} response */
    async completeGitHubAppManifest(request, response) {
      try {
        const query = /** @type {{code?: string, state?: string}} */ (
          request.query
        );
        const location = await githubConnections.completeManifest({
          code: query.code ?? "",
          state: query.state ?? "",
        });
        writeStatus(response, 303, { location });
      } catch (error) {
        redirectCallbackFailure(response, error, githubConnections);
      }
    },
    /** @param {import("fastify").FastifyRequest} request @param {import("fastify").FastifyReply} response */
    async completeGitHubAppInstallation(request, response) {
      try {
        const query =
          /** @type {{installation_id?: string, setup_action?: string, state?: string}} */ (
            request.query
          );
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
