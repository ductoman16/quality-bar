import {
  prepareForgejoRepositoryEnablement,
  prepareGitHubRepositoryEnablement,
} from "./repository-provider-verification.js";

/** @param {{getForgejoConnections: () => any, getGitHubConnections: () => any}} services */
export function createRepositoryProviderApplicationDependencies(services) {
  return {
    resolveForgeCredential(
      /** @type {string} */ connectionId,
      /** @type {"forgejo" | "github"} */ provider,
    ) {
      const connectionService =
        provider === "github"
          ? services.getGitHubConnections()
          : services.getForgejoConnections();
      return connectionService.acquireRepositoryGitCredential(connectionId);
    },
    async verifyForgeRepository(
      /** @type {number} */ forgeRepositoryId,
      /** @type {"forgejo" | "github"} */ provider,
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
