import { GitHubConnectionError } from "./github-connection-error.js";
export { failGitHubRepositoryVerification } from "./github-verification-error.js";
import { RepositoryError } from "./repository-validation.js";

/**
 * @param {typeof import("./repository-git.js").verifyRepositoryRead} verifyGit
 * @param {{clone_url: string, id: number}} repository
 * @param {string} token
 * @param {number[]} affectedRepositoryIds
 */
export async function verifyGitHubRepositoryRead(
  verifyGit,
  repository,
  token,
  affectedRepositoryIds,
) {
  try {
    await verifyGit(
      repository.clone_url,
      { token, username: "x-access-token" },
      {
        definitiveHttpStatuses: [401, 403, 404],
        followRedirects: false,
      },
    );
  } catch (cause) {
    if (
      cause instanceof RepositoryError &&
      cause.code === "repository_git_read_failed"
    ) {
      throw new GitHubConnectionError(
        "github_repository_git_read_failed",
        "GitHub Repository Git read verification failed",
        { affectedRepositoryIds, cause, repositoryId: repository.id },
      );
    }
    throw new GitHubConnectionError(
      "github_git_verification_failed",
      "GitHub Repository Git verification could not complete",
      { affectedRepositoryIds, cause, repositoryId: repository.id },
    );
  }
}
