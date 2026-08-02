import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { createGateDefinitions } from "../scripts/verification/gate-definitions.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");

test("issue 134 proof is owned by cost-free deterministic gates without another cross-process smoke", () => {
  const evidence = JSON.parse(
    readFileSync(
      resolve(
        repositoryRoot,
        "evidence/quality-foundation/issue-134-execution-races.json",
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

  assert.equal(evidence.ticket, 134);
  assert.deepEqual(evidence.acceptance_scenarios, ["ACC-08"]);
  assert.equal(evidence.cross_process_e2e_scenarios_added, 0);
  for (const [layer, proof] of Object.entries(evidence.proof)) {
    assert.ok(
      [
        "unit",
        "sqlite_integration",
        "sqlite_failure_integration",
        "process_integration",
        "adapter_integration",
      ].includes(layer),
    );
    for (const [gateName, testPaths] of Object.entries(proof)) {
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
