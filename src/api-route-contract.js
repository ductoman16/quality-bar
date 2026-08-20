/**
 * @typedef {{
 *   listAuthorityAttributions: (query: { cursor?: string, limit?: string }) => unknown,
 *   readSystemStatus: () => unknown,
 *   recordAuthorityAttribution: (event: import("./api-authorization.js").AttributionEvent) => void,
 *   repositories: Omit<ReturnType<typeof import("./repository.js").createRepositoryService>, "resolvePushedSelectors" | "resolvePullRequestChangeset">,
 *   githubConnections: ReturnType<typeof import("./github-connection.js").createGitHubConnectionService>,
 *   forgejoConnections: ReturnType<typeof import("./forgejo-connection.js").createForgejoConnectionService>,
 *   repositoryGuidance: ReturnType<typeof import("./repository-guidance.js").createRepositoryGuidanceService>,
 *   reviews: ReturnType<typeof import("./review.js").createReviewService>,
 *   analytics: ReturnType<typeof import("./analytics.js").createAnalyticsService>
 * }} ApiRouteDependencies
 */

export {};
