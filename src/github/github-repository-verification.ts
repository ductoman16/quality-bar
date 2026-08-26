import { GITHUB_REQUIRED_PERMISSIONS } from "./github-app-manifest.ts";
import { GitHubConnectionError } from "./github-connection-error.ts";

export async function verifyGitHubRepositories(
  verifyInstallation: (
    credential: any,
    installationId: number,
    repositoryIds: number[],
  ) => Promise<any>,
  credential: any,
  installationId: number,
  repositoryIds: number[],
) {
  const verification = await verifyInstallation(
    credential,
    installationId,
    repositoryIds,
  );
  const repositories = verification.repositories.filter(
    (repository: { id: number }) => repositoryIds.includes(repository.id),
  );
  const repositoryIdsFound = new Set(
    repositories.map((repository: { id: number }) => repository.id),
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
      (repository: { id: number }) => repository.id,
    ),
    capabilities: verification.capabilities,
    permissions: GITHUB_REQUIRED_PERMISSIONS,
    principal: verification.principal,
    repositories,
    repositoryEvidence: verification.repositoryEvidence,
  };
}
