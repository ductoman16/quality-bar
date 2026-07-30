export const WAIVER_ADJUDICATION_GATE_DEFINITIONS = [
  {
    name: "waiver-adjudication-unit",
    testGroup:
      "focused-exact-request-finding-criterion-review-version-evaluation-changeset-schema-and-inspection-prompt-plus-complete-decision-set-validation-effective-outcome-precedence-subsequent-request-action-exact-operational-lifecycle-and-recovery-classification",
    failureCode: "waiver_adjudication_unit_tests_failed",
    arguments: [
      "--test",
      "test/waiver-adjudication-recovery.test.js",
      "test/waiver-operational-schema.test.js",
      "test/waiver-adjudication-evidence.test.js",
      "test/waiver-adjudication-result.test.js",
      "test/waiver-adjudication-execution.test.js",
      "test/waiver-effective-outcome.test.js",
      "test/waiver-request-lifecycle.test.js",
    ],
  },
  {
    name: "waiver-adjudication-browser-component",
    testGroup:
      "queued-focused-waiver-adjudication-mixed-decision-meanings-exact-owning-failure-browser-only-exhausted-recovery-and-distinct-decision-error-retry-actions",
    failureCode: "waiver_adjudication_browser_component_tests_failed",
    arguments: [
      "--test",
      "test/waiver-adjudication-actions-browser-component.test.js",
      "test/waiver-adjudication-browser-component.test.js",
    ],
  },
  {
    name: "waiver-adjudication-sqlite-integration",
    testGroup:
      "focused-claim-v38-v40-v42-migration-first-valid-atomic-complete-immutable-decision-set-current-effective-outcome-governed-error-retry-pre-start-same-identity-and-started-failure-cancellation-recovery-revised-rationale-three-request-limit-and-raw-partial-rejection",
    failureCode: "waiver_adjudication_sqlite_integration_tests_failed",
    arguments: [
      "--test",
      "test/evaluation-result-waiver-immutability-sqlite-integration.test.js",
      "test/waiver-adjudication-claim-sqlite-integration.test.js",
      "test/waiver-adjudication-definitive-pre-start-sqlite-integration.test.js",
      "test/waiver-adjudication-pre-start-sqlite-integration.test.js",
      "test/waiver-adjudication-recovery-lineage-sqlite-integration.test.js",
      "test/waiver-adjudication-recovery-sqlite-integration.test.js",
      "test/waiver-adjudication-result-sqlite-integration.test.js",
      "test/waiver-adjudication-schema-migration.test.js",
      "test/waiver-request-lifecycle-schema-migration.test.js",
      "test/waiver-request-lifecycle-schema-integrity-sqlite-integration.test.js",
      "test/waiver-request-lifecycle-sqlite-integration.test.js",
      "test/waiver-error-retry-lifecycle-sqlite-integration.test.js",
    ],
  },
];
