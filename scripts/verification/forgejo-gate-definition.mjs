export const forgejoGateDefinitions = [
  {
    name: "forgejo-fixture-integration",
    testGroup:
      "forgejo-v16-fixture-required-routes-pagination-polling-rate-gates-accepted-waiver-same-coordinate-reference-read-only-pat-rotation-and-connection-reactivation-boundary",
    failureCode: "forgejo_fixture_integration_tests_failed",
    arguments: [
      "--test",
      "test/forgejo-v16-failure-integration.test.js",
      "test/forgejo-v16-integration.test.js",
      "test/forgejo-automatic-evaluation-fixture-integration.test.js",
      "test/forgejo-polling-fixture-integration.test.js",
      "test/forgejo-v16-publication-fixture-integration.test.js",
    ],
  },
  {
    name: "forgejo-v16-integration",
    testGroup:
      "forgejo-v16-profile-scopes-required-routes-selected-repository-enumeration-private-git-read-polling-baseline-accepted-waiver-same-coordinate-publication-pat-rotation-and-connection-reactivation-boundary",
    failureCode: "forgejo_v16_integration_tests_failed",
    arguments: ["--test", "test/forgejo-v16-service-integration.test.js"],
  },
];

export const FORGEJO_SQLITE_TESTS = [
  "test/forgejo-automatic-evaluation-failure-sqlite-integration.test.js",
  "test/forgejo-automatic-evaluation-sqlite-integration.test.js",
  "test/forgejo-automatic-evaluation-supersession-sqlite-integration.test.js",
  "test/forgejo-connection-rotation-sqlite-integration.test.js",
  "test/forgejo-connection-empty-rotation-sqlite-integration.test.js",
  "test/forgejo-connection-lifecycle-sqlite-integration.test.js",
  "test/forgejo-connection-schema-migration.test.js",
  "test/forgejo-connection-concurrency-sqlite-integration.test.js",
  "test/forgejo-connection-sqlite-integration.test.js",
  "test/forgejo-polling-sqlite-integration.test.js",
  "test/forgejo-repository-reactivation-sqlite-integration.test.js",
  "test/forgejo-repository-enablement-race-sqlite-integration.test.js",
  "test/forgejo-publication.test.js",
  "test/forgejo-delivery-core-sqlite-integration.test.js",
  "test/forgejo-delivery-lifecycle-sqlite-integration.test.js",
  "test/forgejo-delivery-sqlite-integration.test.js",
];

export const FORGEJO_UNIT_TESTS = [
  "test/forgejo-connection-lifecycle.test.js",
  "test/forgejo-connection.test.js",
  "test/forgejo-commit-status.test.js",
  "test/forgejo-feedback.test.js",
  "test/forgejo-delivery.test.js",
  "test/forgejo-v16-publication.test.js",
  "test/forgejo-automatic-evaluation.test.js",
  "test/forgejo-polling.test.js",
];

export const FORGEJO_BROWSER_TESTS = [
  "test/forgejo-connection-browser-component.test.js",
  "test/forgejo-automatic-evaluation-browser-component.test.js",
  "test/forgejo-feedback-browser-component.test.js",
];
