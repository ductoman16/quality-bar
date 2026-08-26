export type ApiRouteDependencies = {
  listAuthorityAttributions: (query: {
    cursor?: string;
    limit?: string;
  }) => unknown;
  readSystemStatus: () => unknown;
  recordAuthorityAttribution: (
    event: import("./api-authorization.ts").AttributionEvent,
  ) => void;
  repositories: Omit<
    ReturnType<
      typeof import("./repository/repository.ts").createRepositoryService
    >,
    "resolvePushedSelectors" | "resolvePullRequestChangeset"
  >;
  githubConnections: ReturnType<
    typeof import("./github/github-connection.ts").createGitHubConnectionService
  >;
  forgejoConnections: ReturnType<
    typeof import("./forgejo/forgejo-connection.ts").createForgejoConnectionService
  >;
  repositoryGuidance: ReturnType<
    typeof import("./repository/repository-guidance.ts").createRepositoryGuidanceService
  >;
  reviews: ReturnType<typeof import("./review/review.ts").createReviewService>;
  analytics: ReturnType<
    typeof import("./analytics/analytics.ts").createAnalyticsService
  >;
};

export {};
