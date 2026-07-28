export const SQLITE_BACKUP_FAILURE_GATE = {
  name: "sqlite-failure-integration",
  testGroup: "validated-backup-sqlite-failure-boundary",
  failureCode: "sqlite_failure_integration_tests_failed",
  arguments: ["--test", "test/sqlite-backup-failure-integration.test.js"],
};
