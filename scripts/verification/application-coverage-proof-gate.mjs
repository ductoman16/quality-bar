export const APPLICATION_COVERAGE_PROOF_GATE = Object.freeze({
  name: "application-coverage-proof",
  testGroup: "application-coverage-ledger-and-boundary",
  failureCode: "application_coverage_proof_failed",
  arguments: [
    "--test",
    "test/application-coverage-policy.test.js",
    "test/application-coverage-ledger.test.js",
    "test/application-coverage-history.test.js",
  ],
});
