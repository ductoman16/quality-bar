import { GitHubConnectionError } from "./github-connection-error.js";
import { forgejoDefinitiveFailureScope } from "./forgejo-failure.js";
import { fail as failRepository } from "./repository-validation.js";

const REPOSITORY_SCOPED_GITHUB_ERRORS = new Set([
  "github_private_git_read_failed",
  "github_repository_api_access_failed",
  "github_repository_git_read_failed",
  "github_repository_selection_unavailable",
]);

/**
 * @param {{selectRepositories: (request: unknown, trigger: "enablement", options: {deferCommit: true}) => Promise<unknown>}} githubConnections
 * @param {number} forgeRepositoryId
 */
export async function prepareGitHubRepositoryEnablement(
  githubConnections,
  forgeRepositoryId,
) {
  try {
    return await githubConnections.selectRepositories(
      { repository_ids: [forgeRepositoryId] },
      "enablement",
      { deferCommit: true },
    );
  } catch (error) {
    if (
      error instanceof GitHubConnectionError &&
      REPOSITORY_SCOPED_GITHUB_ERRORS.has(error.code) &&
      error.repositoryId === forgeRepositoryId
    ) {
      failRepository(error.code, error.message, error);
    }
    if (error instanceof GitHubConnectionError) {
      throw new GitHubConnectionError(error.code, error.message, {
        cause: error,
        commit: typeof error.commit === "function" ? error.commit : undefined,
      });
    }
    throw new TypeError("Forge Repository verification failed", {
      cause: error,
    });
  }
}

/**
 * @param {{prepareRepositoryEnablement: (forgeRepositoryId: number) => Promise<{commit?: (transaction: any) => void} | void>}} forgejoConnections
 * @param {number} forgeRepositoryId
 */
export async function prepareForgejoRepositoryEnablement(
  forgejoConnections,
  forgeRepositoryId,
) {
  try {
    return await forgejoConnections.prepareRepositoryEnablement(
      forgeRepositoryId,
    );
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      typeof error.code === "string" &&
      forgejoDefinitiveFailureScope({
        code: error.code,
        repositoryId:
          "repositoryId" in error && Number.isSafeInteger(error.repositoryId)
            ? Number(error.repositoryId)
            : undefined,
      }) === "repository" &&
      "repositoryId" in error &&
      Number.isSafeInteger(error.repositoryId) &&
      Number(error.repositoryId) === forgeRepositoryId
    ) {
      failRepository(error.code, error.message, error);
    }
    if (
      error instanceof Error &&
      "code" in error &&
      typeof error.code === "string"
    ) {
      throw error;
    }
    throw new TypeError("Forge Repository verification failed", {
      cause: error,
    });
  }
}
