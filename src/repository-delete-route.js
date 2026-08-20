import { writeBrowserJsonMutation } from "./api-mutation.js";
import { isUnavailableError } from "./http-request.js";

/**
 * @param {import("fastify").FastifyRequest} request
 * @param {import("fastify").FastifyReply} response
 * @param {{
 *   repositories: Pick<ReturnType<typeof import("./repository.js").createRepositoryService>, "list" | "remove">,
 *   repositoryId: string,
 * }} options
 */
export async function writeRepositoryDeletion(
  request,
  response,
  { repositories, repositoryId },
) {
  const deletionConflictCodes = new Set([
    "repository_delete_unsupported",
    "repository_lifecycle_conflict",
  ]);
  await writeBrowserJsonMutation(request, response, {
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
    mutate: () => {
      repositories.remove(repositoryId);
      return null;
    },
    statusFor: (code, error) =>
      code === "repository_not_found"
        ? 404
        : deletionConflictCodes.has(code)
          ? 409
          : isUnavailableError(error)
            ? 503
            : 422,
    unexpectedMessage: "Repository deletion failed",
  });
}
