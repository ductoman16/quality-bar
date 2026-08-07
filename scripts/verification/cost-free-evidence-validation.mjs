import { createGateDefinitions } from "./gate-definitions.mjs";
import { createManifest } from "./manifest-reporting.mjs";
import { readVerificationMetadata } from "./metadata.mjs";
import { validateReleaseCanaries } from "./release-canary-schema.mjs";
import { auditTraceability } from "./traceability-audit.mjs";
import {
  createVerificationAggregation,
  readVerificationOwnership,
} from "./verification-aggregation.mjs";

const MAX_MANIFEST_BYTES = 1024 * 1024;

/** @param {unknown} value @returns {value is Record<string, any>} */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @param {Record<string, any>} value @param {string[]} keys */
function hasExactKeys(value, keys) {
  return Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

/** @param {unknown} value */
function positiveInteger(value) {
  return Number.isSafeInteger(value) && /** @type {number} */ (value) > 0;
}

/** @param {unknown} manifest */
function invalid(manifest) {
  let serialized;
  try {
    serialized = JSON.stringify(manifest);
  } catch {
    return true;
  }
  return (
    serialized === undefined ||
    Buffer.byteLength(serialized) > MAX_MANIFEST_BYTES
  );
}

/**
 * @param {any} gate
 * @param {import("./gate-definitions.mjs").GateDefinition} definition
 */
function validateGate(gate, definition) {
  if (
    !isRecord(gate) ||
    !hasExactKeys(
      gate,
      definition.factsMarker
        ? [
            "checkGroups",
            "command",
            "durationMs",
            "facts",
            "name",
            "outcome",
            "testGroups",
            "tools",
          ]
        : [
            "checkGroups",
            "command",
            "durationMs",
            "name",
            "outcome",
            "testGroups",
            "tools",
          ],
    ) ||
    gate.name !== definition.name ||
    gate.command !==
      `${definition.command ?? "node"} ${definition.arguments.join(" ")}` ||
    gate.outcome !== "pass" ||
    !Number.isSafeInteger(gate.durationMs) ||
    gate.durationMs < 0 ||
    JSON.stringify(gate.tools) !==
      JSON.stringify(definition.tools ?? { node: process.version })
  ) {
    return false;
  }
  const expectedTestGroups = definition.testGroup ? [definition.testGroup] : [];
  if (
    !Array.isArray(gate.testGroups) ||
    gate.testGroups.length !== expectedTestGroups.length ||
    gate.testGroups.some(
      (group, index) =>
        !isRecord(group) ||
        !hasExactKeys(group, ["count", "name"]) ||
        group.name !== expectedTestGroups[index] ||
        !positiveInteger(group.count),
    )
  ) {
    return false;
  }
  const expectedCheckGroups = definition.checkGroups ?? [];
  if (
    !Array.isArray(gate.checkGroups) ||
    gate.checkGroups.length !== expectedCheckGroups.length ||
    gate.checkGroups.some((group, index) => {
      const expected = expectedCheckGroups[index];
      return (
        !isRecord(group) ||
        !hasExactKeys(group, ["count", "name", "unit"]) ||
        group.name !== expected.name ||
        group.unit !== expected.unit ||
        !positiveInteger(group.count)
      );
    })
  ) {
    return false;
  }
  if (definition.factsMarker) {
    let factError;
    try {
      factError = definition.validateFacts?.(gate.facts) ?? null;
    } catch {
      return false;
    }
    if (
      factError !== null ||
      (definition.factsMustPass && gate.facts?.outcome !== "pass")
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Validate the complete same-repository cost-free proof before any provider spend.
 *
 * @param {unknown} input
 * @param {{repositoryRoot: string, sourceCommit: string}} expected
 */
export function validateCostFreeEvidence(input, expected) {
  if (
    invalid(input) ||
    !isRecord(input) ||
    !hasExactKeys(input, [
      "applicationCoverage",
      "componentVersions",
      "evidenceVersion",
      "failures",
      "invokedGates",
      "outcome",
      "performance",
      "platform",
      "releaseCanaries",
      "runnerVersions",
      "securityBoundary",
      "sourceCommit",
      "totalDurationMs",
      "verification",
    ]) ||
    input.evidenceVersion !== 1 ||
    input.sourceCommit !== expected.sourceCommit ||
    input.outcome !== "pass" ||
    !Array.isArray(input.failures) ||
    input.failures.length !== 0 ||
    !Number.isSafeInteger(input.totalDurationMs) ||
    input.totalDurationMs < 0
  ) {
    throw new TypeError("cost-free verification evidence is incomplete");
  }
  const metadata = readVerificationMetadata(expected.repositoryRoot);
  if (metadata.sourceCommit !== expected.sourceCommit) {
    throw new TypeError("cost-free verification source identity is stale");
  }
  const definitions = createGateDefinitions(metadata);
  if (
    !Array.isArray(input.invokedGates) ||
    input.invokedGates.length !== definitions.length ||
    input.invokedGates.some(
      (gate, index) => !validateGate(gate, definitions[index]),
    )
  ) {
    throw new TypeError("cost-free verification gate evidence is incomplete");
  }
  const verificationAggregation = createVerificationAggregation({
    definitions,
    ownership: readVerificationOwnership(expected.repositoryRoot),
    traceability: auditTraceability({
      repositoryRoot: expected.repositoryRoot,
    }),
  });
  const canonical = createManifest({
    failures: [],
    gates: input.invokedGates,
    metadata,
    startedAt: performance.now(),
    verificationAggregation,
  });
  const canonicalFields = /** @type {const} */ ([
    "applicationCoverage",
    "componentVersions",
    "failures",
    "outcome",
    "performance",
    "platform",
    "runnerVersions",
    "securityBoundary",
    "sourceCommit",
    "verification",
  ]);
  for (const field of canonicalFields) {
    if (JSON.stringify(input[field]) !== JSON.stringify(canonical[field])) {
      throw new TypeError(`cost-free verification ${field} is invalid`);
    }
  }
  if (input.releaseCanaries !== null) {
    validateReleaseCanaries(input.releaseCanaries, expected.sourceCommit);
  }
  return input;
}
