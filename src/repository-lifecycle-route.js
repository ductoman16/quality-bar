import { writeBrowserJsonMutation } from "./api-mutation.js";
import { isUnavailableError } from "./http-request.js";

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {import("node:http").ServerResponse} response
 * @param {{
 *   browserOrigin: string,
 *   browserSessions: ReturnType<typeof import("./browser-session.js").createBrowserSessionService>,
 *   repositories: Pick<ReturnType<typeof import("./repository.js").createRepositoryService>, "list" | "setLifecycle">,
 *   encodedRepositoryId: string,
 *   requestUrl: URL
 * }} options
 */
export async function writeRepositoryLifecycleChange(
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
    browserOrigin,
    browserSessions,
    failureCode: "repository_lifecycle_change_failed",
    failureDetails: (code) =>
      lifecycleConflictCodes.has(code) && repositoryId
        ? { current: currentRepository() }
        : undefined,
    mutate: (body) => {
      try {
        repositoryId = decodeURIComponent(encodedRepositoryId);
      } catch {
        throw Object.assign(new Error("request_malformed"), {
          code: "request_malformed",
        });
      }
      return repositories.setLifecycle(repositoryId, body);
    },
    requestUrl,
    statusFor: (code, error) =>
      code === "request_malformed"
        ? 400
        : code === "repository_not_found"
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
