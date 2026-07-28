/**
 * @typedef {{
 *   browserOrigin: string,
 *   browserSessions: ReturnType<typeof import("./browser-session.js").createBrowserSessionService>,
 *   listAuthorityAttributions: (query: { cursor?: string, limit?: string }) => unknown,
 *   readSystemStatus: () => unknown,
 *   recordAuthorityAttribution: (event: import("./api-authorization.js").AttributionEvent) => void,
 *   repositories: ReturnType<typeof import("./repository.js").createRepositoryService>,
 *   githubConnections: ReturnType<typeof import("./github-connection.js").createGitHubConnectionService>,
 *   forgejoConnections: ReturnType<typeof import("./forgejo-connection.js").createForgejoConnectionService>,
 *   repositoryGuidance: ReturnType<typeof import("./repository-guidance.js").createRepositoryGuidanceService>,
 *   reviews: ReturnType<typeof import("./review.js").createReviewService>
 * }} ApiRouteDependencies
 */

export {};
