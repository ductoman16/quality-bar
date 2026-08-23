import { writeBrowserJsonMutation } from "../api-mutation.js";
import { isUnavailableError } from "../http-request.js";

/**
 * @param {import("fastify").FastifyRequest} request
 * @param {import("fastify").FastifyReply} response
 * @param {{
 *   repositories: Pick<ReturnType<typeof import("./repository.js").createRepositoryService>, "list" | "setLifecycle">,
 *   repositoryId: string,
 * }} options
 */
export async function writeRepositoryLifecycleChange(
  request,
  response,
  { repositories, repositoryId },
) {
  const providerConflictCodes = new Set([
    "forgejo_repository_enablement_conflict",
    "forgejo_repository_identity_conflict",
    "github_repository_enablement_conflict",
    "github_repository_identity_conflict",
  ]);
  const lifecycleConflictCodes = new Set([
    ...providerConflictCodes,
    "repository_lifecycle_conflict",
    "repository_reactivation_requires_registration",
    "repository_retired",
    "repository_retirement_unsupported",
  ]);
  function currentRepository() {
    return (
      repositories
        .list()
        .find((repository) => repository.id === repositoryId) ?? null
    );
  }
  await writeBrowserJsonMutation(request, response, {
    failureCode: "repository_lifecycle_change_failed",
    failureDetails: (code) =>
      lifecycleConflictCodes.has(code) && repositoryId
        ? { current: currentRepository() }
        : undefined,
    mutate: (body) => repositories.setLifecycle(repositoryId, body),
    statusFor: (code, error) =>
      code === "repository_not_found"
        ? 404
        : lifecycleConflictCodes.has(code)
          ? 409
          : isUnavailableError(error) ||
              code === "repository_git_verification_unavailable"
            ? 503
            : 422,
    unexpectedMessage: "Repository lifecycle change failed",
  });
}
