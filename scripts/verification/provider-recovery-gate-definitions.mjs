export const PROVIDER_RECOVERY_GATE_DEFINITIONS = [
  {
    name: "provider-recovery-unit",
    testGroup:
      "provider-aware-persisted-delay-definitive-waiting-and-uncertain-delivery-recovery",
    failureCode: "provider_recovery_unit_tests_failed",
    arguments: [
      "--test",
      "test/provider-recovery.test.js",
      "test/provider-recovery-verification.test.js",
    ],
  },
  {
    name: "provider-recovery-sqlite-failure-integration",
    testGroup:
      "provider-gate-and-delivery-state-sqlite-write-failure-with-no-partial-success",
    failureCode: "provider_recovery_sqlite_failure_integration_tests_failed",
    arguments: [
      "--test",
      "test/provider-recovery-sqlite-failure-integration.test.js",
    ],
  },
  {
    name: "provider-recovery-process-integration",
    testGroup:
      "provider-wide-delivery-gate-and-uncertain-source-recovery-across-process-boundary",
    failureCode: "provider_recovery_process_integration_tests_failed",
    arguments: ["--test", "test/provider-recovery-process-integration.test.js"],
  },
  {
    name: "provider-recovery-adapter-integration",
    testGroup:
      "github-and-forgejo-publication-adapter-reconciliation-before-duplicate-create",
    failureCode: "provider_recovery_adapter_integration_tests_failed",
    arguments: [
      "--test",
      "test/provider-recovery-adapter-integration.test.js",
      "test/provider-recovery-adapter-surfaces-integration.test.js",
    ],
  },
];
