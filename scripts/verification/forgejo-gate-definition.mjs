export const forgejoGateDefinitions = [
  {
    name: "forgejo-fixture-integration",
    testGroup:
      "forgejo-v16-fixture-required-routes-pagination-and-read-only-boundary",
    failureCode: "forgejo_fixture_integration_tests_failed",
    arguments: ["--test", "test/forgejo-v16-integration.test.js"],
  },
  {
    name: "forgejo-v16-integration",
    testGroup:
      "forgejo-v16-profile-scopes-required-routes-selected-repository-enumeration-and-private-git-read-boundary",
    failureCode: "forgejo_v16_integration_tests_failed",
    arguments: ["--test", "test/forgejo-v16-integration.test.js"],
  },
];
