export const SQLITE_RESTORE_FAILURE_GATE = {
  name: "sqlite-restore-failure-integration",
  testGroup: "offline-restore-atomic-sqlite-failure-boundary",
  failureCode: "sqlite_restore_failure_integration_tests_failed",
  arguments: [
    "--test",
    "test/offline-restore-missing-target-sqlite-failure-integration.test.js",
    "test/offline-restore-sqlite-failure-integration.test.js",
  ],
};
