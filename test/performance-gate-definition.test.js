import assert from "node:assert/strict";
import { test } from "node:test";

import { createGateDefinitions } from "../scripts/verification/gate-definitions.mjs";

test("the canonical gate owns the personal-v1 performance fixture and fact marker", () => {
  const gate = createGateDefinitions({
    applicationVersion: "1.2.3",
    coverageToolVersion: "12.0.0",
    eslintPluginNodeVersion: "18.2.2",
    eslintVersion: "9.39.1",
    formatterVersion: "3.7.4",
    jsonSchemaFormatsVersion: "3.0.1",
    jsonSchemaValidatorVersion: "8.20.0",
    openApiValidatorVersion: "2.9.0",
    typeCheckerVersion: "7.0.2",
  }).find((definition) => definition.name === "performance-budgets");

  assert.ok(gate);
  assert.deepEqual(gate.arguments, [
    "scripts/verification/run-performance-budget.mjs",
    "--test",
    "test/performance-budget.test.js",
    "test/performance-budget-gate.test.js",
    "test/performance-gate-definition.test.js",
  ]);
  assert.equal(gate.factsMarker, "QUALITY_BAR_PERFORMANCE_FACTS");
  assert.equal(gate.failureCode, "performance_budgets_failed");
});
