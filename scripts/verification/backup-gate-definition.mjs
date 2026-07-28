export const SQLITE_BACKUP_FAILURE_GATE = {
  name: "sqlite-failure-integration",
  testGroup:
    "runtime-storage-reserve-and-validated-backup-sqlite-failure-boundary",
  failureCode: "sqlite_failure_integration_tests_failed",
  arguments: [
    "--test",
    "test/storage-reserve-sqlite-integration.test.js",
    "test/sqlite-backup-failure-integration.test.js",
  ],
};
