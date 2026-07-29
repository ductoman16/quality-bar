export const forgejoGateDefinitions = [
  {
    name: "forgejo-fixture-integration",
    testGroup:
      "forgejo-v16-fixture-required-routes-pagination-polling-rate-gates-read-only-pat-rotation-and-connection-reactivation-boundary",
    failureCode: "forgejo_fixture_integration_tests_failed",
    arguments: [
      "--test",
      "test/forgejo-v16-failure-integration.test.js",
      "test/forgejo-v16-integration.test.js",
      "test/forgejo-polling-fixture-integration.test.js",
    ],
  },
  {
    name: "forgejo-v16-integration",
    testGroup:
      "forgejo-v16-profile-scopes-required-routes-selected-repository-enumeration-private-git-read-polling-baseline-pat-rotation-and-connection-reactivation-boundary",
    failureCode: "forgejo_v16_integration_tests_failed",
    arguments: ["--test", "test/forgejo-v16-service-integration.test.js"],
  },
];

export const FORGEJO_SQLITE_TESTS = [
  "test/forgejo-connection-rotation-sqlite-integration.test.js",
  "test/forgejo-connection-lifecycle-sqlite-integration.test.js",
  "test/forgejo-connection-schema-migration.test.js",
  "test/forgejo-connection-concurrency-sqlite-integration.test.js",
  "test/forgejo-connection-sqlite-integration.test.js",
  "test/forgejo-polling-sqlite-integration.test.js",
  "test/forgejo-repository-reactivation-sqlite-integration.test.js",
  "test/forgejo-repository-enablement-race-sqlite-integration.test.js",
];
