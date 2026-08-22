/**
 * @typedef {{
 *   listAuthorityAttributions: (query: { cursor?: string, limit?: string }) => unknown,
 *   readSystemStatus: () => unknown,
 *   recordAuthorityAttribution: (event: import("./api-authorization.js").AttributionEvent) => void,
 *   repositories: Omit<ReturnType<typeof import("./repository/repository.js").createRepositoryService>, "resolvePushedSelectors" | "resolvePullRequestChangeset">,
 *   githubConnections: ReturnType<typeof import("./github/github-connection.js").createGitHubConnectionService>,
 *   forgejoConnections: ReturnType<typeof import("./forgejo/forgejo-connection.js").createForgejoConnectionService>,
 *   repositoryGuidance: ReturnType<typeof import("./repository/repository-guidance.js").createRepositoryGuidanceService>,
 *   reviews: ReturnType<typeof import("./review/review.js").createReviewService>,
 *   analytics: ReturnType<typeof import("./analytics/analytics.js").createAnalyticsService>
 * }} ApiRouteDependencies
 */

export {};
