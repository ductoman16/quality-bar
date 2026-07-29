import { REVIEW_RUN_CLAIM_GATE_DEFINITIONS } from "./review-run-claim-gate-definitions.mjs";
import { APPLICABILITY_GATE_DEFINITIONS } from "./applicability-gate-definitions.mjs";

export const REVIEW_RUN_ADMISSION_GATE_DEFINITIONS = [
  ...APPLICABILITY_GATE_DEFINITIONS,
  {
    name: "review-run-execution-unit",
    testGroup:
      "review-run-pre-start-git-native-inspect-on-demand-no-host-content-selection-unavailable-material-error-prompt-credential-exclusion-transcript-terminal-counter-first-valid-submission-channel-closure-durable-operator-cancellation-fixed-independent-fifteen-minute-deadlines-and-codex-process-group-termination-boundaries",
    failureCode: "review_run_execution_unit_tests_failed",
    arguments: [
      "--test",
      "test/review-run-codex-adapter.test.js",
      "test/review-run-codex-cancellation.test.js",
      "test/review-run-codex-termination.test.js",
      "test/review-run-deadline.test.js",
      "test/review-run-evidence-adapter.test.js",
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
      "fresh-writable-disposable-frozen-commit-large-repository-unchanged-context-lfs-pointer-no-smudge-uninitialized-submodule-credential-free-checkout-before-review-run-deadline-multiple-independent-review-runs-over-one-frozen-changeset-honest-file-change-kind-sides-and-exact-criterion-result-coverage-boundary",
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
      "first-valid-fenced-aggregate-terminal-review-runs-durable-cancellation-race-preserved-sibling-facts-outcome-precedence-append-only-transcript-exact-run-measurement-deadline-failure-invalid-attempt-zero-storage-four-meaning-criterion-result-opaque-finding-identity-inherited-impact-exact-run-failure-no-fallback-and-v26-v27-v30-v31-v32-v33-migration-boundary",
    failureCode: "review_run_result_sqlite_integration_tests_failed",
    arguments: [
      "--test",
      "test/evaluation-aggregation-sqlite-integration.test.js",
      "test/evaluation-cancellation-schema-migration.test.js",
      "test/evaluation-cancellation-sqlite-integration.test.js",
      "test/review-run-deadline-sqlite-integration.test.js",
      "test/review-run-result-sqlite-integration.test.js",
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
    name: "adapter-integration",
    testGroup: "review-run-admission-codex-adapter-dependency-boundary",
    failureCode: "adapter_integration_tests_failed",
    arguments: [
      "--test",
      "test/review-run-admission-adapter-integration.test.js",
    ],
  },
  {
    name: "process-integration",
    testGroup: "review-run-admission-cross-process-capacity-boundary",
    failureCode: "process_integration_tests_failed",
    arguments: [
      "--test",
      "test/review-run-admission-process-integration.test.js",
    ],
  },
  ...REVIEW_RUN_CLAIM_GATE_DEFINITIONS,
];
