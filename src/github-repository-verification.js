import { GITHUB_REQUIRED_PERMISSIONS } from "./github-app-manifest.js";
import { GitHubConnectionError } from "./github-connection-error.js";

/**
 * @param {(credential: any, installationId: number, repositoryIds: number[]) => Promise<any>} verifyInstallation
 * @param {any} credential
 * @param {number} installationId
 * @param {number[]} repositoryIds
 */
export async function verifyGitHubRepositories(
  verifyInstallation,
  credential,
  installationId,
  repositoryIds,
) {
  const verification = await verifyInstallation(
    credential,
    installationId,
    repositoryIds,
  );
  const repositories = verification.repositories.filter(
    /** @param {{id: number}} repository */ (repository) =>
      repositoryIds.includes(repository.id),
  );
  const repositoryIdsFound = new Set(
    repositories.map(
      /** @param {{id: number}} repository */ (repository) => repository.id,
    ),
  );
  if (
    repositories.length !== repositoryIds.length ||
    repositoryIds.some((id) => !repositoryIdsFound.has(id))
  ) {
    const repositoryId = repositoryIds.find(
      (id) => !repositoryIdsFound.has(id),
    );
    throw new GitHubConnectionError(
      "github_repository_selection_unavailable",
      "Selected GitHub Repository is not accessible to the Connection",
      { affectedRepositoryIds: repositoryIds, repositoryId },
    );
  }
  return {
    affectedRepositoryIds: verification.repositories.map(
      /** @param {{id: number}} repository */ (repository) => repository.id,
    ),
    capabilities: verification.capabilities,
    permissions: GITHUB_REQUIRED_PERMISSIONS,
    principal: verification.principal,
    repositories,
    repositoryEvidence: verification.repositoryEvidence,
  };
}
