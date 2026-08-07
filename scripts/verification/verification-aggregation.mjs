import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  QUALITY_BAR_ACCEPTANCE_SCENARIOS,
  QUALITY_BAR_EXPECTED_CROSS_PROCESS_SMOKES,
  QUALITY_BAR_SPECIFICATION_PARENT,
  QUALITY_BAR_VERIFICATION_PROOF,
  QUALITY_BAR_VERIFICATION_SOURCES,
} from "./verification-contract.mjs";

export const VERIFICATION_OWNERSHIP_PATH =
  "evidence/quality-foundation/issue-123-verification.json";

/** @typedef {{gate: string, testGroup: string}} CrossProcessSmoke */
/**
 * @typedef {{
 *   marker: string,
 *   parent: number,
 *   sources: string[],
 *   acceptanceScenarios: string[],
 *   proof: string[],
 *   localGates: string[],
 *   crossProcessSmokes: CrossProcessSmoke[],
 * }} VerificationOwnership
 */
/**
 * @typedef {{
 *   groups: {
 *     local: string[],
 *     "pre-push": string[],
 *     "linux-amd64-ci": string[],
 *   },
 *   crossProcessSmokes: CrossProcessSmoke[],
 *   ownership: Omit<VerificationOwnership, "localGates" | "crossProcessSmokes">,
 *   traceability: import("./traceability-audit.mjs").TraceabilityAudit,
 * }} VerificationAggregation
 */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @param {string} field
 * @param {(value: string) => boolean} [predicate]
 */
function requiredStrings(value, field, predicate = () => true) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((entry) => typeof entry !== "string" || !predicate(entry))
  ) {
    throw new Error(`verification_ownership_${field}_invalid`);
  }
  return [...value];
}

/** @param {string[]} actual @param {readonly string[]} expected @param {string} field */
function requireExactStrings(actual, expected, field) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`verification_ownership_${field}_invalid`);
  }
}

/** @param {unknown} value */
function readCrossProcessSmokes(value) {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error("verification_ownership_cross_process_smokes_invalid");
  }
  const smokes = value.map((entry) => {
    if (
      !isRecord(entry) ||
      typeof entry.gate !== "string" ||
      typeof entry.testGroup !== "string"
    ) {
      throw new Error("verification_ownership_cross_process_smoke_invalid");
    }
    return { gate: entry.gate, testGroup: entry.testGroup };
  });
  if (new Set(smokes.map((smoke) => smoke.gate)).size !== smokes.length) {
    throw new Error("verification_ownership_cross_process_smokes_invalid");
  }
  if (
    JSON.stringify(smokes) !==
    JSON.stringify(QUALITY_BAR_EXPECTED_CROSS_PROCESS_SMOKES)
  ) {
    throw new Error("verification_ownership_cross_process_smokes_invalid");
  }
  return smokes;
}

/** @param {string} repositoryRoot */
export function readVerificationOwnership(repositoryRoot) {
  const markerPath = resolve(repositoryRoot, VERIFICATION_OWNERSHIP_PATH);
  let marker;
  try {
    marker = JSON.parse(readFileSync(markerPath, "utf8"));
  } catch (error) {
    throw new Error(
      `verification_ownership_marker_unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (!isRecord(marker)) {
    throw new Error("verification_ownership_marker_invalid");
  }

  if (
    marker.ticket !== 123 ||
    marker.parent !== QUALITY_BAR_SPECIFICATION_PARENT
  ) {
    throw new Error("verification_ownership_identity_invalid");
  }
  const sources = requiredStrings(marker.sources, "sources");
  requireExactStrings(sources, QUALITY_BAR_VERIFICATION_SOURCES, "sources");
  const acceptanceScenarios = requiredStrings(
    marker.acceptance_scenarios,
    "acceptance_scenarios",
    (value) => /^ACC-\d{2}$/u.test(value),
  );
  requireExactStrings(
    acceptanceScenarios,
    QUALITY_BAR_ACCEPTANCE_SCENARIOS,
    "acceptance_scenarios",
  );
  const proof = requiredStrings(marker.proof, "proof");
  requireExactStrings(proof, QUALITY_BAR_VERIFICATION_PROOF, "proof");
  const localGates = requiredStrings(marker.local_gates, "local_gates");
  const crossProcessSmokes = readCrossProcessSmokes(
    marker.cross_process_smokes,
  );
  if (marker.final_outcome !== "pass") {
    throw new Error("verification_ownership_final_outcome_invalid");
  }

  return {
    marker: VERIFICATION_OWNERSHIP_PATH,
    parent: QUALITY_BAR_SPECIFICATION_PARENT,
    sources,
    acceptanceScenarios,
    proof,
    localGates,
    crossProcessSmokes,
  };
}

/**
 * @param {{
 *   definitions: import("./gate-definitions.mjs").GateDefinition[],
 *   ownership: VerificationOwnership,
 *   traceability: import("./traceability-audit.mjs").TraceabilityAudit,
 * }} input
 * @returns {VerificationAggregation}
 */
export function createVerificationAggregation({
  definitions,
  ownership,
  traceability,
}) {
  if (
    !traceability ||
    traceability.parent !== QUALITY_BAR_SPECIFICATION_PARENT
  ) {
    throw new Error("verification_aggregation_traceability_invalid");
  }
  const names = definitions.map((definition) => definition.name);
  if (new Set(names).size !== names.length) {
    throw new Error("verification_aggregation_duplicate_gate");
  }
  const definitionsByName = new Map(
    definitions.map((definition) => [definition.name, definition]),
  );

  const localGates = ownership.localGates;
  if (
    new Set(localGates).size !== localGates.length ||
    localGates.some((name) => !definitionsByName.has(name))
  ) {
    throw new Error("verification_aggregation_local_gate_invalid");
  }

  const crossProcessSmokes = ownership.crossProcessSmokes.map((smoke) => {
    const definition = definitionsByName.get(smoke.gate);
    if (!definition || definition.testGroup !== smoke.testGroup) {
      throw new Error("verification_aggregation_cross_process_smoke_invalid");
    }
    return smoke;
  });
  if (crossProcessSmokes.length !== 2) {
    throw new Error("verification_aggregation_cross_process_smokes_invalid");
  }
  if (
    JSON.stringify(crossProcessSmokes) !==
    JSON.stringify(QUALITY_BAR_EXPECTED_CROSS_PROCESS_SMOKES)
  ) {
    throw new Error("verification_aggregation_cross_process_smokes_invalid");
  }
  const crossProcessNames = new Set(
    crossProcessSmokes.map((smoke) => smoke.gate),
  );
  const prePushGates = names.filter((name) => !crossProcessNames.has(name));

  return {
    groups: {
      local: [...localGates],
      "pre-push": prePushGates,
      "linux-amd64-ci": [...names],
    },
    crossProcessSmokes: [...crossProcessSmokes],
    ownership: {
      marker: ownership.marker,
      parent: ownership.parent,
      sources: [...ownership.sources],
      acceptanceScenarios: [...ownership.acceptanceScenarios],
      proof: [...ownership.proof],
    },
    traceability,
  };
}
