import { WAIVER_ADJUDICATION_GATE_DEFINITIONS } from "./waiver-adjudication-gate-definitions.mjs";

export const FAKE_CODEX_GATE_DEFINITION = {
  name: "fake-codex-integration",
  testGroup:
    "focused-waiver-adjudication-mixed-decision-set-current-error-outcome-same-immutable-request-error-retry-exact-input-and-started-failure-plus-waiver-configuration-and-exact-secret-excluding-text-applicability-selection-file-change-kind-sides-invalid-correction-first-valid-four-meaning-criterion-result-large-repository-unchanged-monorepo-context-git-native-inspect-on-demand-sqlite-result-multiple-independent-review-run-aggregation-distinct-same-changeset-rerun-executions-and-results-started-codex-authentication-fixed-failure-no-partial-result-raw-transcript-cli-timing-terminal-counter-deadline-and-durable-cancellation-submission-closure-process-group-force-kill-review-run-fake-codex-boundary",
  failureCode: "fake_codex_integration_tests_failed",
  arguments: [
    "--test",
    "test/waiver-adjudicator-configuration-fake-codex-integration.test.js",
    "test/waiver-batch-fake-codex-integration.test.js",
    "test/waiver-adjudication-fake-codex-integration.test.js",
    "test/evaluation-aggregation-fake-codex-integration.test.js",
    "test/evaluation-fake-codex-integration.test.js",
    "test/review-run-fake-codex-integration.test.js",
  ],
};

export const CODEX_GATE_DEFINITIONS = [
  FAKE_CODEX_GATE_DEFINITION,
  ...WAIVER_ADJUDICATION_GATE_DEFINITIONS,
];
