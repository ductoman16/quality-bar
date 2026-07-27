import { commandFailure } from "./failure-reporting.mjs";
import { runCommand } from "./command-executor.mjs";

/** @typedef {import("./manifest-reporting.mjs").VerificationGate} GateEvidence */

/**
 * @param {string} repositoryRoot
 * @param {import("./gate-definitions.mjs").GateDefinition} definition
 * @param {{ commandExecutor?: import("./command-executor.mjs").CommandExecutor }} [options]
 */
export function runGate(repositoryRoot, definition, options = {}) {
  const { commandExecutor = runCommand } = options;
  const gateStartedAt = performance.now();
  const command = definition.command ?? process.execPath;
  const result = commandExecutor(command, definition.arguments, repositoryRoot);
  const durationMs = Math.round(performance.now() - gateStartedAt);
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  const testCountMatch = output.match(/^(?:#|ℹ) tests (\d+)$/m);
  const testCount = testCountMatch
    ? Number.parseInt(testCountMatch[1], 10)
    : null;
  const checkGroups = (definition.checkGroups ?? []).map((group) => {
    const matchedCount = group.countPattern
      ? output.match(group.countPattern)?.[1]
      : undefined;
    return {
      name: group.name,
      count:
        group.count ??
        (matchedCount === undefined ? null : Number.parseInt(matchedCount, 10)),
      unit: group.unit,
    };
  });
  const factsMatch = definition.factsMarker
    ? output.match(new RegExp(`^(?:# )?${definition.factsMarker} (.+)$`, "m"))
    : null;
  /** @type {GateEvidence["facts"] | null} */
  let facts = null;
  let failure;

  if (result.status !== 0) {
    failure = {
      code: definition.failureCode,
      detail: commandFailure(result, command, definition.arguments),
    };
  } else if (definition.testGroup && (testCount === null || testCount < 1)) {
    failure = {
      code: "verification_evidence_invalid",
      detail: `${definition.name} passed without a positive '# tests' summary`,
    };
  } else if (checkGroups.some((group) => group.count === null)) {
    failure = {
      code: "verification_evidence_invalid",
      detail: `${definition.name} passed without its required check count`,
    };
  } else if (
    checkGroups.some((group) => group.count !== null && group.count < 1)
  ) {
    failure = {
      code: "verification_evidence_invalid",
      detail: `${definition.name} passed without a positive check count`,
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
        detail: `${definition.factsMarker} is not valid JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  /** @type {GateEvidence} */
  const evidence = {
    name: definition.name,
    command: `${definition.command ?? "node"} ${definition.arguments.join(" ")}`,
    testGroups: definition.testGroup
      ? [{ name: definition.testGroup, count: testCount }]
      : [],
    checkGroups,
    tools: definition.tools ?? { node: process.version },
    durationMs,
    outcome: failure ? "fail" : "pass",
  };
  if (facts) {
    evidence.facts = facts;
  }

  return { evidence, failure, output };
}
