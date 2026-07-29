export const APPLICABILITY_GATE_DEFINITIONS = [
  {
    name: "applicability-unit",
    testGroup:
      "restricted-cel-deterministic-match-failed-branch-exact-predicate-error-and-no-content-copy-boundary",
    failureCode: "applicability_unit_tests_failed",
    arguments: ["--test", "test/applicability-evaluation.test.js"],
  },
  {
    name: "applicability-git-integration",
    testGroup: "frozen-changeset-applicability-git-boundary",
    failureCode: "applicability_git_integration_tests_failed",
    arguments: ["--test", "test/applicability-git-integration.test.js"],
  },
  {
    name: "applicability-browser-component",
    testGroup: "applicability-result-outcome-scope-and-exact-error-boundary",
    failureCode: "applicability_browser_component_tests_failed",
    arguments: [
      "--test",
      "test/applicability-result-browser-component.test.js",
    ],
  },
  {
    name: "applicability-sqlite-integration",
    testGroup:
      "one-result-per-assigned-review-exact-outcome-run-selection-immutability-and-v30-migration-boundary",
    failureCode: "applicability_sqlite_integration_tests_failed",
    arguments: [
      "--test",
      "test/applicability-result-authority-sqlite-integration.test.js",
      "test/applicability-result-schema-migration.test.js",
      "test/applicability-result-sqlite-integration.test.js",
      "test/applicability-selection-set-sqlite-integration.test.js",
    ],
  },
];
