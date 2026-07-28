export const SECURITY_INTEGRATION_GATE = {
  name: "security-integration",
  testGroup:
    "validated-backup-browser-authority-and-request-security-integration",
  failureCode: "security_integration_tests_failed",
  arguments: [
    "--test",
    "test/backup-security-integration.test.js",
    "test/operator-password-bootstrap.test.js",
    "test/browser-session-durability-security-integration.test.js",
    "test/browser-session-failure-security-integration.test.js",
    "test/browser-session-proxy-security-integration.test.js",
    "test/browser-session-bearer-security-integration.test.js",
    "test/browser-session-contract-security-integration.test.js",
  ],
};
