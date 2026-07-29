import { REVIEW_RUN_CLAIM_GATE_DEFINITIONS } from "./review-run-claim-gate-definitions.mjs";

export const REVIEW_RUN_ADMISSION_GATE_DEFINITIONS = [
  {
    name: "review-run-admission-sqlite-integration",
    testGroup: "review-run-admission-atomic-persistence-boundary",
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
