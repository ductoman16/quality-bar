export const REVIEW_RUN_CLAIM_GATE_DEFINITIONS = [
  {
    name: "review-run-claim-unit",
    testGroup: "review-run-claim-renewal-and-expiration-contract",
    failureCode: "review_run_claim_unit_tests_failed",
    arguments: ["--test", "test/review-run-claim.test.js"],
  },
  {
    name: "review-run-claim-sqlite-integration",
    testGroup: "review-run-claim-lease-fencing-and-v24-migration-boundary",
    failureCode: "review_run_claim_sqlite_integration_tests_failed",
    arguments: [
      "--test",
      "test/review-run-claim-sqlite-integration.test.js",
      "test/review-run-claim-schema-migration.test.js",
    ],
  },
  {
    name: "review-run-claim-adapter-integration",
    testGroup: "review-run-claim-before-fake-codex-launch-boundary",
    failureCode: "review_run_claim_adapter_integration_tests_failed",
    arguments: ["--test", "test/review-run-claim-adapter-integration.test.js"],
  },
  {
    name: "review-run-claim-process-integration",
    testGroup: "review-run-claim-cross-process-fencing-boundary",
    failureCode: "review_run_claim_process_integration_tests_failed",
    arguments: ["--test", "test/review-run-claim-process-integration.test.js"],
  },
];
