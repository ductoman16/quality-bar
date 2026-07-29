const sqlite = [
  "test/repository-credential-rotation-sqlite-integration.test.js",
  "test/repository-sqlite-integration.test.js",
  "test/repository-removal-sqlite-integration.test.js",
  "test/repository-deletion-race-sqlite-integration.test.js",
  "test/repository-provider-deletion-race-sqlite-integration.test.js",
  "test/repository-usage-schema-migration.test.js",
];

const githubSqliteRaces = [
  "test/github-repository-selection-race-sqlite-integration.test.js",
  "test/github-repository-selection-absence-race-sqlite-integration.test.js",
  "test/github-polling-race-sqlite-integration.test.js",
];

const http = [
  "test/repository-http-integration.test.js",
  "test/repository-guidance-http-integration.test.js",
  "test/repository-lifecycle-http-integration.test.js",
  "test/repository-removal-http-integration.test.js",
];

export const repositoryGateTests = { githubSqliteRaces, http, sqlite };
