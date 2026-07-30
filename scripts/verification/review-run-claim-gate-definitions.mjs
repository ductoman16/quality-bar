export const REVIEW_RUN_CLAIM_GATE_DEFINITIONS = [
  {
    name: "codex-execution-claim-unit",
    testGroup:
      "shared-review-run-and-waiver-adjudication-oldest-ready-first-selection-renewal-and-expiration-contract",
    failureCode: "review_run_claim_unit_tests_failed",
    arguments: [
      "--test",
      "test/codex-execution-claim.test.js",
      "test/review-run-claim.test.js",
    ],
  },
  {
    name: "codex-execution-claim-sqlite-integration",
    testGroup:
      "shared-ready-at-stable-identity-ordering-durable-slot-owner-error-lease-fencing-and-v24-migration-boundary",
    failureCode: "review_run_claim_sqlite_integration_tests_failed",
    arguments: [
      "--test",
      "test/codex-execution-ordering-sqlite-integration.test.js",
      "test/review-run-claim-sqlite-integration.test.js",
      "test/review-run-claim-schema-migration.test.js",
    ],
  },
  {
    name: "codex-execution-claim-adapter-integration",
    testGroup:
      "shared-oldest-ready-claim-before-owning-fake-codex-launch-boundary",
    failureCode: "review_run_claim_adapter_integration_tests_failed",
    arguments: ["--test", "test/review-run-claim-adapter-integration.test.js"],
  },
  {
    name: "codex-execution-claim-process-integration",
    testGroup:
      "shared-oldest-ready-waiver-and-review-run-cross-process-fencing-boundary",
    failureCode: "review_run_claim_process_integration_tests_failed",
    arguments: ["--test", "test/review-run-claim-process-integration.test.js"],
  },
];
