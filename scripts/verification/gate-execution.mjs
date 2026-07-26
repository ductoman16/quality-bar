import { spawnSync } from "node:child_process";

import { commandFailure } from "./failure-reporting.mjs";

export function runGate(repositoryRoot, definition) {
  const gateStartedAt = performance.now();
  const result = spawnSync(process.execPath, definition.arguments, {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  const durationMs = Math.round(performance.now() - gateStartedAt);
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  const testCountMatch = output.match(/^(?:#|ℹ) tests (\d+)$/m);
  const testCount = testCountMatch
    ? Number.parseInt(testCountMatch[1], 10)
    : null;
  const factsMatch = definition.factsMarker
    ? output.match(new RegExp(`^(?:# )?${definition.factsMarker} (.+)$`, "m"))
    : null;
  let facts = null;
  let failure;

  if (result.status !== 0) {
    failure = {
      code: definition.failureCode,
      detail: commandFailure(result, process.execPath, definition.arguments),
    };
  } else if (testCount === null || testCount < 1) {
    failure = {
      code: "verification_evidence_invalid",
      detail: `${definition.name} passed without a positive '# tests' summary`,
    };
  } else if (definition.factsMarker && !factsMatch) {
    failure = {
      code: "verification_evidence_invalid",
      detail: `${definition.name} passed without ${definition.factsMarker}`,
    };
  } else if (factsMatch) {
    try {
      facts = JSON.parse(factsMatch[1]);
      const invalidFacts = definition.validateFacts?.(facts);
      if (invalidFacts) {
        facts = null;
        failure = {
          code: "verification_evidence_invalid",
          detail: `${definition.factsMarker} ${invalidFacts}`,
        };
      }
    } catch (error) {
      failure = {
        code: "verification_evidence_invalid",
        detail: `${definition.factsMarker} is not valid JSON: ${error.message}`,
      };
    }
  }

  const evidence = {
    name: definition.name,
    command: `node ${definition.arguments.join(" ")}`,
    testGroups: [{ name: definition.testGroup, count: testCount }],
    durationMs,
    outcome: failure ? "fail" : "pass",
  };
  if (facts) {
    evidence.facts = facts;
  }

  return { evidence, failure, output };
}
