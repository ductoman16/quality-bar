import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { createGateDefinitions } from "./gate-definitions.mjs";
import { readVerificationMetadata } from "./metadata.mjs";
import {
  QUALITY_BAR_EXPECTED_CROSS_PROCESS_SMOKES,
  QUALITY_BAR_EXPECTED_PROOF_REGISTRATIONS,
} from "./traceability-contract.mjs";
import {
  QUALITY_BAR_EXPECTED_PACKAGED_API_MCP_SMOKE,
  QUALITY_BAR_EXPECTED_PROOF_IMPLEMENTATIONS,
} from "./verification-contract.mjs";

/** @param {unknown} actual @param {unknown} expected @param {string} field */
function requireExact(actual, expected, field) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`traceability_audit_${field}_stale`);
  }
}

/** @param {string} repositoryRoot */
function readLiveGateDefinitions(repositoryRoot) {
  try {
    return createGateDefinitions(readVerificationMetadata(repositoryRoot));
  } catch {
    throw new Error("traceability_audit_proof_gate_binding_unproved");
  }
}

/** @param {import("./gate-definitions.mjs").GateDefinition[]} definitions @param {Record<string, any>} binding */
function validateLivePackagedSmokeBinding(definitions, binding) {
  const definition = definitions.find(
    (candidate) => candidate.name === "package-integration",
  );
  if (
    !definition ||
    typeof definition.testGroup !== "string" ||
    !Array.isArray(definition.arguments) ||
    definition.arguments.length === 0
  ) {
    throw new Error("traceability_audit_proof_gate_binding_unproved");
  }
  const derivedBinding = {
    gate: definition.name,
    testGroup: definition.testGroup,
    command: definition.command ?? "node",
    arguments: [...definition.arguments],
    path: definition.arguments.at(-1),
  };
  requireExact(
    derivedBinding,
    QUALITY_BAR_EXPECTED_PACKAGED_API_MCP_SMOKE,
    "proof_gate_bindings",
  );
  requireExact(binding, derivedBinding, "proof_gate_bindings");
}

/** @param {import("./gate-definitions.mjs").GateDefinition[]} definitions @param {unknown} smokes */
function validateLiveCrossProcessSmokes(definitions, smokes) {
  requireExact(
    smokes,
    QUALITY_BAR_EXPECTED_CROSS_PROCESS_SMOKES,
    "cross_process_smokes",
  );
  const derivedSmokes = QUALITY_BAR_EXPECTED_CROSS_PROCESS_SMOKES.map(
    (expected) => {
      const definition = definitions.find(
        (candidate) => candidate.name === expected.gate,
      );
      if (!definition || definition.testGroup !== expected.testGroup) {
        throw new Error(
          "traceability_audit_proof_cross_process_smokes_unproved",
        );
      }
      return { gate: definition.name, testGroup: definition.testGroup };
    },
  );
  requireExact(
    derivedSmokes,
    QUALITY_BAR_EXPECTED_CROSS_PROCESS_SMOKES,
    "cross_process_smokes",
  );
}

/**
 * @param {string} repositoryRoot
 * @param {string} layer
 * @param {any} registration
 * @param {import("./gate-definitions.mjs").GateDefinition[]} definitions
 * @param {unknown} invokedGates
 */
function validateLiveProofRegistration(
  repositoryRoot,
  layer,
  registration,
  definitions,
  invokedGates,
) {
  try {
    if (registration.type === "gate") {
      if (
        !Array.isArray(registration.names) ||
        registration.names.length === 0 ||
        registration.names.some(
          /** @param {unknown} name */
          (name) =>
            typeof name !== "string" ||
            !definitions.some((definition) => definition.name === name),
        )
      ) {
        throw new Error("missing live gate");
      }
      if (
        invokedGates !== undefined &&
        (!Array.isArray(invokedGates) ||
          registration.names.some(
            /** @param {string} name */
            (name) =>
              !invokedGates.some(
                /** @param {any} gate */
                (gate) => gate?.name === name && gate.outcome === "pass",
              ),
          ))
      ) {
        throw new Error("missing invoked gate");
      }
      return;
    }
    if (registration.type === "runner") {
      const source = readFileSync(
        resolve(repositoryRoot, registration.entrypoint),
        "utf8",
      );
      if (!source.includes(registration.token)) {
        throw new Error("missing live runner import");
      }
      if (
        invokedGates !== undefined &&
        (!Array.isArray(invokedGates) || invokedGates.length === 0)
      ) {
        throw new Error("missing invoked runner");
      }
      return;
    }
    if (registration.type === "script") {
      const packageJson = JSON.parse(
        readFileSync(resolve(repositoryRoot, "package.json"), "utf8"),
      );
      if (
        typeof packageJson.scripts?.[registration.script] !== "string" ||
        !packageJson.scripts[registration.script].includes(registration.path)
      ) {
        throw new Error("missing live package script");
      }
      return;
    }
  } catch {
    throw new Error(`traceability_audit_proof_registration_unproved: ${layer}`);
  }
  throw new Error(`traceability_audit_proof_registration_unproved: ${layer}`);
}

/**
 * @param {{
 *   marker: Record<string, any>,
 *   repositoryRoot: string,
 *   proofLayers: string[],
 *   invokedGates?: unknown,
 * }} input
 */
export function validateTraceabilityProofs({
  marker,
  repositoryRoot,
  proofLayers,
  invokedGates,
}) {
  const expectedImplementations =
    /** @type {Record<string, readonly string[]>} */ (
      QUALITY_BAR_EXPECTED_PROOF_IMPLEMENTATIONS
    );
  const expectedRegistrations = /** @type {Record<string, any>} */ (
    QUALITY_BAR_EXPECTED_PROOF_REGISTRATIONS
  );
  requireExact(
    Object.keys(expectedRegistrations).sort(),
    [...proofLayers].sort(),
    "proof_registrations",
  );
  const bindings = marker.proof_gate_bindings;
  if (
    typeof bindings !== "object" ||
    bindings === null ||
    Array.isArray(bindings)
  ) {
    throw new Error("traceability_audit_proof_gate_bindings_missing");
  }
  requireExact(
    Object.keys(bindings),
    ["packaged-api-mcp-smoke"],
    "proof_gate_bindings",
  );
  requireExact(
    bindings["packaged-api-mcp-smoke"],
    QUALITY_BAR_EXPECTED_PACKAGED_API_MCP_SMOKE,
    "proof_gate_bindings",
  );

  const implementations = marker.proof_implementations;
  if (
    typeof implementations !== "object" ||
    implementations === null ||
    Array.isArray(implementations)
  ) {
    throw new Error("traceability_audit_proof_implementations_missing");
  }
  requireExact(
    Object.keys(implementations).sort(),
    [...proofLayers].sort(),
    "proof_implementations",
  );
  for (const layer of proofLayers) {
    const paths = implementations[layer];
    if (
      !Array.isArray(paths) ||
      paths.length === 0 ||
      paths.some((path) => typeof path !== "string")
    ) {
      throw new Error(`traceability_audit_proof_unproved: ${layer}`);
    }
  }
  for (const layer of proofLayers) {
    requireExact(
      implementations[layer],
      expectedImplementations[layer],
      "proof_implementations",
    );
  }
  for (const layer of proofLayers) {
    if (
      implementations[layer].some(
        /** @param {string} path */
        (path) => {
          if (!existsSync(resolve(repositoryRoot, path))) {
            return true;
          }
          try {
            const stats = statSync(resolve(repositoryRoot, path));
            return !stats.isFile() || stats.size === 0;
          } catch {
            return true;
          }
        },
      )
    ) {
      throw new Error(`traceability_audit_proof_unproved: ${layer}`);
    }
  }
  const definitions = readLiveGateDefinitions(repositoryRoot);
  for (const layer of proofLayers) {
    validateLiveProofRegistration(
      repositoryRoot,
      layer,
      expectedRegistrations[layer],
      definitions,
      invokedGates,
    );
  }
  validateLivePackagedSmokeBinding(
    definitions,
    bindings["packaged-api-mcp-smoke"],
  );
  validateLiveCrossProcessSmokes(definitions, marker.cross_process_smokes);
}
