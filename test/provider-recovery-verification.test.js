import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { createGateDefinitions } from "../scripts/verification/gate-definitions.mjs";

test("issue 105 proof is owned by four cost-free deterministic layers without another cross-process smoke", () => {
  const evidence = JSON.parse(
    readFileSync(
      resolve(
        import.meta.dirname,
        "../evidence/quality-foundation/issue-105-provider-recovery.json",
      ),
      "utf8",
    ),
  );
  const definitions = createGateDefinitions({
    applicationVersion: "1.2.3",
    coverageToolVersion: "12.0.0",
    eslintPluginNodeVersion: "18.2.2",
    eslintVersion: "9.39.1",
    formatterVersion: "3.7.4",
    jsonSchemaFormatsVersion: "3.0.1",
    jsonSchemaValidatorVersion: "8.20.0",
    openApiValidatorVersion: "2.9.0",
    typeCheckerVersion: "7.0.2",
  });
  const gates = new Map(
    definitions.map((definition) => [definition.name, definition]),
  );
  const expectedLayers = [
    "unit",
    "sqlite_failure_integration",
    "process_integration",
    "adapter_integration",
  ];

  assert.equal(evidence.ticket, 105);
  assert.deepEqual(evidence.acceptance_scenarios, ["ACC-08"]);
  assert.deepEqual(Object.keys(evidence.proof), expectedLayers);
  assert.equal(evidence.cross_process_e2e_scenarios_added, 0);
  assert.equal(evidence.final_outcome, "pass");
  for (const layer of expectedLayers) {
    for (const [gateName, testPaths] of Object.entries(evidence.proof[layer])) {
      const gate = gates.get(gateName);
      assert.ok(gate, `missing verification gate ${gateName}`);
      assert.notEqual(gateName, "operator-browser-smoke");
      assert.notEqual(gateName, "package-http-mcp-smoke");
      for (const testPath of testPaths) {
        assert.ok(
          gate.arguments.includes(testPath),
          `${gateName} does not own ${testPath}`,
        );
      }
    }
  }
});
