export const SQLITE_BACKUP_FAILURE_GATE = {
  name: "sqlite-failure-integration",
  testGroup:
    "runtime-storage-reserve-validated-backup-review-run-admission-and-shared-codex-execution-claim-sqlite-failure-boundary",
  failureCode: "sqlite_failure_integration_tests_failed",
  arguments: [
    "--test",
    "test/storage-reserve-sqlite-integration.test.js",
    "test/sqlite-backup-failure-integration.test.js",
    "test/review-run-admission-sqlite-failure-integration.test.js",
    "test/review-run-claim-sqlite-failure-integration.test.js",
    "test/codex-execution-ordering-sqlite-failure-integration.test.js",
  ],
};
