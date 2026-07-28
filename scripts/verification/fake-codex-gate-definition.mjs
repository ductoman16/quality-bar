export const FAKE_CODEX_GATE_DEFINITION = {
  name: "fake-codex-integration",
  testGroup:
    "waiver-adjudication-configuration-and-zero-review-evaluation-fake-codex-boundary",
  failureCode: "fake_codex_integration_tests_failed",
  arguments: [
    "--test",
    "test/waiver-adjudicator-configuration-fake-codex-integration.test.js",
    "test/evaluation-fake-codex-integration.test.js",
  ],
};
