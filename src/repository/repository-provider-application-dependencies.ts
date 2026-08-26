import {
  prepareForgejoRepositoryEnablement,
  prepareGitHubRepositoryEnablement,
} from "./repository-provider-verification.ts";

export function createRepositoryProviderApplicationDependencies(services: {
  getForgejoConnections: () => any;
  getGitHubConnections: () => any;
}) {
  return {
    resolveForgeCredential(
      connectionId: string,
      provider: "forgejo" | "github",
    ) {
      const connectionService =
        provider === "github"
          ? services.getGitHubConnections()
          : services.getForgejoConnections();
      return connectionService.acquireRepositoryGitCredential(connectionId);
    },
    async verifyForgeRepository(
      forgeRepositoryId: number,
      provider: "forgejo" | "github",
    ) {
      return provider === "forgejo"
        ? prepareForgejoRepositoryEnablement(
            services.getForgejoConnections(),
            forgeRepositoryId,
          )
        : prepareGitHubRepositoryEnablement(
            services.getGitHubConnections(),
            forgeRepositoryId,
          );
    },
  };
}
