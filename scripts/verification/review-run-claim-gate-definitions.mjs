export const REVIEW_RUN_CLAIM_GATE_DEFINITIONS = [
  {
    name: "application-shutdown-unit",
    testGroup:
      "graceful-admission-polling-worker-claim-gates-running-drain-and-existing-pre-start-retry-contract",
    failureCode: "application_shutdown_unit_tests_failed",
    arguments: [
      "--test",
      "test/application-shutdown.test.js",
      "test/application-execution-shutdown.test.js",
      "test/codex-execution-pre-start.test.js",
      "test/execution-race-verification.test.js",
    ],
  },
  {
    name: "application-shutdown-sqlite-failure-integration",
    testGroup:
      "shutdown-raced-admission-and-pre-start-claim-durability-without-partial-results-or-idempotency",
    failureCode: "application_shutdown_sqlite_failure_tests_failed",
    arguments: [
      "--test",
      "test/application-shutdown-sqlite-failure-integration.test.js",
    ],
  },
  {
    name: "application-shutdown-process-integration",
    testGroup: "first-signal-graceful-drain-and-second-signal-forced-stop",
    failureCode: "application_shutdown_process_tests_failed",
    arguments: [
      "--test",
      "test/application-shutdown-process-integration.test.js",
    ],
  },
  {
    name: "codex-execution-claim-unit",
    testGroup:
      "shared-review-run-and-waiver-adjudication-oldest-ready-first-selection-renewal-expiration-and-restart-classification-contract",
    failureCode: "review_run_claim_unit_tests_failed",
    arguments: [
      "--test",
      "test/application-execution-runtime.test.js",
      "test/application-recovery-startup.test.js",
      "test/codex-execution-concurrency.test.js",
      "test/codex-execution-claim.test.js",
      "test/codex-execution-recovery.test.js",
      "test/codex-execution-worker.test.js",
      "test/io-execution-pool.test.js",
      "test/forgejo-polling-runner-io.test.js",
      "test/review-run-claim.test.js",
    ],
  },
  {
    name: "codex-execution-race-sqlite-integration",
    testGroup:
      "deterministic-review-run-and-waiver-adjudication-accepted-submission-cancellation-lease-replacement-and-fencing-without-partial-facts",
    failureCode: "codex_execution_race_sqlite_integration_tests_failed",
    arguments: [
      "--test",
      "test/codex-execution-race-sqlite-integration.test.js",
    ],
  },
  {
    name: "codex-execution-race-sqlite-failure-integration",
    testGroup:
      "review-run-and-waiver-adjudication-submission-storage-failure-with-no-partial-facts",
    failureCode: "codex_execution_race_sqlite_failure_tests_failed",
    arguments: [
      "--test",
      "test/codex-execution-race-sqlite-failure-integration.test.js",
    ],
  },
  {
    name: "codex-execution-claim-sqlite-integration",
    testGroup:
      "shared-ready-at-stable-identity-ordering-durable-slot-owner-error-lease-fencing-and-v24-migration-boundary",
    failureCode: "review_run_claim_sqlite_integration_tests_failed",
    arguments: [
      "--test",
      "test/codex-execution-concurrency-sqlite-integration.test.js",
      "test/codex-execution-ordering-sqlite-integration.test.js",
      "test/review-run-claim-sqlite-integration.test.js",
      "test/review-run-claim-schema-migration.test.js",
    ],
  },
  {
    name: "codex-execution-recovery-sqlite-integration",
    testGroup:
      "queued-survival-interrupted-review-run-and-waiver-failure-submission-cancellation-v44-migration-and-no-automatic-started-retry",
    failureCode: "codex_execution_recovery_sqlite_integration_tests_failed",
    arguments: [
      "--test",
      "test/codex-execution-recovery-schema-migration.test.js",
      "test/codex-execution-recovery-sqlite-integration.test.js",
    ],
  },
  {
    name: "codex-execution-recovery-sqlite-failure-integration",
    testGroup:
      "restart-recovery-durable-write-failure-exact-storage-error-and-no-partial-state",
    failureCode: "codex_execution_recovery_sqlite_failure_tests_failed",
    arguments: [
      "--test",
      "test/codex-execution-recovery-sqlite-failure-integration.test.js",
    ],
  },
  {
    name: "codex-execution-concurrency-sqlite-failure-integration",
    testGroup:
      "durable-concurrency-write-failure-exact-storage-error-no-partial-setting",
    failureCode: "codex_execution_concurrency_sqlite_failure_tests_failed",
    arguments: [
      "--test",
      "test/codex-execution-concurrency-sqlite-failure-integration.test.js",
    ],
  },
  {
    name: "codex-execution-claim-adapter-integration",
    testGroup:
      "shared-oldest-ready-claim-before-owning-fake-codex-launch-and-detached-process-group-tracking-boundary",
    failureCode: "review_run_claim_adapter_integration_tests_failed",
    arguments: ["--test", "test/review-run-claim-adapter-integration.test.js"],
  },
  {
    name: "codex-execution-recovery-process-integration",
    testGroup:
      "gated-identity-anchored-process-group-termination-partial-transcript-retention-and-exact-interrupted-failure",
    failureCode: "codex_execution_recovery_process_integration_tests_failed",
    arguments: [
      "--test",
      "test/codex-execution-recovery-process-integration.test.js",
    ],
  },
  {
    name: "codex-execution-claim-process-integration",
    testGroup:
      "shared-oldest-ready-waiver-and-review-run-cross-process-fencing-boundary",
    failureCode: "review_run_claim_process_integration_tests_failed",
    arguments: ["--test", "test/review-run-claim-process-integration.test.js"],
  },
];
