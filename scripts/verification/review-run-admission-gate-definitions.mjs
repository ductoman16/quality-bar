import { REVIEW_RUN_CLAIM_GATE_DEFINITIONS } from "./review-run-claim-gate-definitions.mjs";
import { APPLICABILITY_GATE_DEFINITIONS } from "./applicability-gate-definitions.mjs";

export const REVIEW_RUN_ADMISSION_GATE_DEFINITIONS = [
  ...APPLICABILITY_GATE_DEFINITIONS,
  {
    name: "review-run-execution-unit",
    testGroup:
      "review-run-pre-start-git-native-inspect-on-demand-no-host-content-selection-unavailable-material-error-prompt-credential-exclusion-transcript-terminal-counter-first-valid-submission-channel-closure-durable-operator-cancellation-fixed-started-codex-failure-catalog-secret-safe-detail-one-attempt-no-provider-fallback-independent-fifteen-minute-deadlines-and-codex-process-group-termination-boundaries",
    failureCode: "review_run_execution_unit_tests_failed",
    arguments: [
      "--test",
      "test/codex-execution-pre-start.test.js",
      "test/review-run-codex-adapter.test.js",
      "test/review-run-codex-failure.test.js",
      "test/review-run-submission-failure.test.js",
      "test/review-run-codex-cancellation.test.js",
      "test/review-run-codex-termination.test.js",
      "test/review-run-deadline.test.js",
      "test/review-run-evidence-adapter.test.js",
      "test/review-run-execution-pre-start.test.js",
      "test/review-run-execution.test.js",
      "test/review-run-inspect-on-demand.test.js",
      "test/review-run-evidence.test.js",
      "test/review-run-submission-channel.test.js",
      "test/evaluation-cancellation.test.js",
    ],
  },
  {
    name: "review-run-result-unit",
    testGroup:
      "evaluation-outcome-precedence-first-valid-exact-criterion-coverage-complete-clear-triggered-not-applicable-and-error-criterion-result-finding-location-validation",
    failureCode: "review_run_result_unit_tests_failed",
    arguments: [
      "--test",
      "test/evaluation-aggregation.test.js",
      "test/review-run-result.test.js",
    ],
  },
  {
    name: "review-run-checkout-git-integration",
    testGroup:
      "fresh-writable-disposable-frozen-commit-large-repository-unchanged-context-lfs-pointer-no-smudge-uninitialized-submodule-credential-free-checkout-before-review-run-deadline-started-codex-authentication-failure-transcript-process-facts-no-retry-no-partial-result-multiple-independent-review-runs-over-one-frozen-changeset-honest-file-change-kind-sides-and-exact-criterion-result-coverage-boundary",
    failureCode: "review_run_checkout_git_integration_tests_failed",
    arguments: [
      "--test",
      "test/review-run-checkout-git-integration.test.js",
      "test/evaluation-aggregation-fake-codex-integration.test.js",
      "test/review-run-fake-codex-integration.test.js",
      "test/review-run-file-changes-git-integration.test.js",
    ],
  },
  {
    name: "review-run-result-sqlite-integration",
    testGroup:
      "first-valid-fenced-aggregate-terminal-review-runs-durable-cancellation-race-preserved-sibling-facts-outcome-precedence-append-only-transcript-exact-run-measurement-started-codex-authentication-and-deadline-failures-invalid-attempt-zero-storage-no-criterion-results-or-findings-four-meaning-criterion-result-opaque-finding-identity-inherited-impact-exact-run-failure-no-fallback-and-v26-v27-v30-v31-v32-v33-migration-boundary",
    failureCode: "review_run_result_sqlite_integration_tests_failed",
    arguments: [
      "--test",
      "test/evaluation-aggregation-sqlite-integration.test.js",
      "test/evaluation-cancellation-schema-migration.test.js",
      "test/evaluation-cancellation-sqlite-integration.test.js",
      "test/evaluation-cancellation-pre-start-sqlite-integration.test.js",
      "test/review-run-deadline-sqlite-integration.test.js",
      "test/review-run-result-sqlite-integration.test.js",
      "test/review-run-submission-failure-sqlite-integration.test.js",
      "test/review-run-evidence-schema-migration.test.js",
      "test/review-run-result-schema-migration.test.js",
    ],
  },
  {
    name: "review-run-admission-sqlite-integration",
    testGroup:
      "review-run-admission-atomic-persistence-distinct-same-changeset-rerun-current-assignment-and-review-version-boundary",
    failureCode: "review_run_admission_sqlite_integration_tests_failed",
    arguments: [
      "--test",
      "test/review-run-admission-sqlite-integration.test.js",
    ],
  },
  {
    name: "review-run-pre-start-sqlite-failure-integration",
    testGroup:
      "accepted-review-run-initial-one-minute-five-minute-transient-retry-definitive-exhaustion-lost-claim-zero-attempt-same-identity-v45-migration-no-partial-result",
    failureCode: "review_run_pre_start_sqlite_failure_integration_tests_failed",
    arguments: [
      "--test",
      "test/review-run-pre-start-sqlite-failure-integration.test.js",
      "test/review-run-pre-start-schema-migration.test.js",
    ],
  },
  {
    name: "adapter-integration",
    testGroup:
      "review-run-admission-codex-adapter-dependency-and-browser-same-identity-pre-start-retry-boundaries",
    failureCode: "adapter_integration_tests_failed",
    arguments: [
      "--test",
      "test/review-run-admission-adapter-integration.test.js",
      "test/evaluation-pre-start-retry-adapter-integration.test.js",
      "test/evaluation-pre-start-retry-browser-component.test.js",
    ],
  },
  {
    name: "process-integration",
    testGroup:
      "review-run-admission-cross-process-capacity-and-durable-pre-start-retry-boundaries",
    failureCode: "process_integration_tests_failed",
    arguments: [
      "--test",
      "test/review-run-admission-process-integration.test.js",
      "test/review-run-pre-start-process-integration.test.js",
    ],
  },
  ...REVIEW_RUN_CLAIM_GATE_DEFINITIONS,
];
