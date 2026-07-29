export const APPLICABILITY_GATE_DEFINITIONS = [
  {
    name: "applicability-unit",
    testGroup:
      "file-change-kind-side-normalized-path-restricted-cel-complete-text-re2-absent-binary-negation-lazy-read-deterministic-match-failed-branch-exact-predicate-error-and-no-content-copy-boundary",
    failureCode: "applicability_unit_tests_failed",
    arguments: [
      "--test",
      "test/applicability-content-evaluation.test.js",
      "test/applicability-evaluation.test.js",
      "test/file-change.test.js",
    ],
  },
  {
    name: "applicability-git-integration",
    testGroup:
      "frozen-changeset-file-change-kind-complete-utf8-nul-free-text-binary-absent-case-sensitive-native-positive-glob-applicability-git-boundary",
    failureCode: "applicability_git_integration_tests_failed",
    arguments: ["--test", "test/applicability-git-integration.test.js"],
  },
  {
    name: "applicability-browser-component",
    testGroup:
      "applicability-result-outcome-scope-matched-before-after-path-and-exact-content-error-boundary",
    failureCode: "applicability_browser_component_tests_failed",
    arguments: [
      "--test",
      "test/applicability-result-browser-component.test.js",
    ],
  },
  {
    name: "applicability-sqlite-integration",
    testGroup:
      "one-result-per-assigned-review-text-binary-negation-unreadable-content-renamed-before-after-path-exact-outcome-run-selection-immutability-and-v30-migration-boundary",
    failureCode: "applicability_sqlite_integration_tests_failed",
    arguments: [
      "--test",
      "test/applicability-content-sqlite-integration.test.js",
      "test/applicability-result-authority-sqlite-integration.test.js",
      "test/applicability-result-schema-migration.test.js",
      "test/applicability-result-sqlite-integration.test.js",
      "test/applicability-selection-set-sqlite-integration.test.js",
    ],
  },
];
