import { validatePerformanceFacts } from "./performance-budget.mjs";

export const PERFORMANCE_BUDGET_GATE = {
  name: "performance-budgets",
  testGroup:
    "four-core-eight-GiB-current-schema-readiness-local-api-read-accepted-mutation-and-ready-queue-claim",
  failureCode: "performance_budgets_failed",
  factsMarker: "QUALITY_BAR_PERFORMANCE_FACTS",
  validateFacts: validatePerformanceFacts,
  factsMustPass: true,
  arguments: [
    "scripts/verification/run-performance-budget.mjs",
    "--test",
    "test/performance-budget.test.js",
    "test/performance-budget-gate.test.js",
    "test/performance-gate-definition.test.js",
  ],
};
