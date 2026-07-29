import { writeBrowserJsonMutation } from "./api-mutation.js";
import { isUnavailableError } from "./http-request.js";

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 * @param {{
 *   browserOrigin: string,
 *   browserSessions: ReturnType<typeof import("./browser-session.js").createBrowserSessionService>,
 *   repositories: Pick<ReturnType<typeof import("./repository.js").createRepositoryService>, "list" | "remove">,
 *   encodedRepositoryId: string,
 *   requestUrl: URL
 * }} options
 */
export async function writeRepositoryDeletion(
  request,
  response,
  {
    browserOrigin,
    browserSessions,
    repositories,
    encodedRepositoryId,
    requestUrl,
  },
) {
  /** @type {string | undefined} */
  let repositoryId;
  const deletionConflictCodes = new Set([
    "repository_delete_unsupported",
    "repository_lifecycle_conflict",
  ]);
  await writeBrowserJsonMutation(request, response, {
    browserOrigin,
    browserSessions,
    failureCode: "repository_delete_failed",
    failureDetails: (code) =>
      deletionConflictCodes.has(code) && repositoryId
        ? {
            current:
              repositories
                .list()
                .find((repository) => repository.id === repositoryId) ?? null,
          }
        : undefined,
    mutate: (body) => {
      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        Object.keys(body).length !== 0
      ) {
        throw Object.assign(new Error("request_malformed"), {
          code: "request_malformed",
        });
      }
      try {
        repositoryId = decodeURIComponent(encodedRepositoryId);
      } catch {
        throw Object.assign(new Error("request_malformed"), {
          code: "request_malformed",
        });
      }
      repositories.remove(repositoryId);
      return null;
    },
    requestUrl,
    statusFor: (code, error) =>
      code === "request_malformed"
        ? 400
        : code === "repository_not_found"
          ? 404
          : deletionConflictCodes.has(code)
            ? 409
            : isUnavailableError(error)
              ? 503
              : 422,
    unexpectedMessage: "Repository deletion failed",
  });
}
