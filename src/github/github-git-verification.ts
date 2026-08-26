import { GitHubConnectionError } from "./github-connection-error.ts";
export { failGitHubRepositoryVerification } from "./github-verification-error.ts";
export { validGitHubRepositoryEvidence } from "./github-verification-error.ts";
import { RepositoryError } from "../repository/repository-validation.ts";

export async function verifyGitHubRepositoryRead(
  verifyGit: typeof import("../repository/repository-git.ts").verifyRepositoryRead,
  repository: { clone_url: string; id: number },
  token: string,
  affectedRepositoryIds: number[],
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
