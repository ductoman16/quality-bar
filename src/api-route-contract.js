/**
 * @typedef {{
 *   browserOrigin: string,
 *   browserSessions: ReturnType<typeof import("./browser-session.js").createBrowserSessionService>,
 *   listAuthorityAttributions: (query: { cursor?: string, limit?: string }) => unknown,
 *   readSystemStatus: () => unknown,
 *   recordAuthorityAttribution: (event: import("./api-authorization.js").AttributionEvent) => void,
 *   repositories: ReturnType<typeof import("./repository.js").createRepositoryService>,
 *   reviews: ReturnType<typeof import("./review.js").createReviewService>
 * }} ApiRouteDependencies
 */

export {};
