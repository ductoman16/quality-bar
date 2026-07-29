import { REVIEW_RUN_CLAIM_GATE_DEFINITIONS } from "./review-run-claim-gate-definitions.mjs";

export const REVIEW_RUN_ADMISSION_GATE_DEFINITIONS = [
  {
    name: "review-run-execution-unit",
    testGroup:
      "review-run-pre-start-prompt-credential-exclusion-and-codex-submission-boundaries",
    failureCode: "review_run_execution_unit_tests_failed",
    arguments: [
      "--test",
      "test/review-run-codex-adapter.test.js",
      "test/review-run-execution.test.js",
      "test/review-run-submission-channel.test.js",
    ],
  },
  {
    name: "review-run-result-unit",
    testGroup:
      "complete-clear-and-triggered-criterion-result-finding-location-validation",
    failureCode: "review_run_result_unit_tests_failed",
    arguments: ["--test", "test/review-run-result.test.js"],
  },
  {
    name: "review-run-checkout-git-integration",
    testGroup:
      "fresh-writable-disposable-frozen-commit-credential-free-checkout-and-honest-file-change-coordinate-boundary",
    failureCode: "review_run_checkout_git_integration_tests_failed",
    arguments: [
      "--test",
      "test/review-run-checkout-git-integration.test.js",
      "test/review-run-file-changes-git-integration.test.js",
    ],
  },
  {
    name: "review-run-result-sqlite-integration",
    testGroup:
      "first-valid-fenced-clear-or-triggered-result-opaque-finding-identity-inherited-impact-no-fallback-boundary-failure-and-v25-migration-boundary",
    failureCode: "review_run_result_sqlite_integration_tests_failed",
    arguments: [
      "--test",
      "test/review-run-result-sqlite-integration.test.js",
      "test/review-run-result-schema-migration.test.js",
    ],
  },
  {
    name: "review-run-admission-sqlite-integration",
    testGroup: "review-run-admission-atomic-persistence-boundary",
    failureCode: "review_run_admission_sqlite_integration_tests_failed",
    arguments: [
      "--test",
      "test/review-run-admission-sqlite-integration.test.js",
    ],
  },
  {
    name: "adapter-integration",
    testGroup: "review-run-admission-codex-adapter-dependency-boundary",
    failureCode: "adapter_integration_tests_failed",
    arguments: [
      "--test",
      "test/review-run-admission-adapter-integration.test.js",
    ],
  },
  {
    name: "process-integration",
    testGroup: "review-run-admission-cross-process-capacity-boundary",
    failureCode: "process_integration_tests_failed",
    arguments: [
      "--test",
      "test/review-run-admission-process-integration.test.js",
    ],
  },
  ...REVIEW_RUN_CLAIM_GATE_DEFINITIONS,
];
