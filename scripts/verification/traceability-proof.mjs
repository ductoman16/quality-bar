import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { createGateDefinitions } from "./gate-definitions.mjs";
import { readVerificationMetadata } from "./metadata.mjs";
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

/** @param {string} repositoryRoot @param {Record<string, any>} binding */
function validateLivePackagedSmokeBinding(repositoryRoot, binding) {
  let definitions;
  try {
    definitions = createGateDefinitions(
      readVerificationMetadata(repositoryRoot),
    );
  } catch {
    throw new Error("traceability_audit_proof_gate_binding_unproved");
  }
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

/**
 * @param {{
 *   marker: Record<string, any>,
 *   repositoryRoot: string,
 *   proofLayers: string[],
 * }} input
 */
export function validateTraceabilityProofs({
  marker,
  repositoryRoot,
  proofLayers,
}) {
  const expectedImplementations =
    /** @type {Record<string, readonly string[]>} */ (
      QUALITY_BAR_EXPECTED_PROOF_IMPLEMENTATIONS
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
        (path) => !existsSync(resolve(repositoryRoot, path)),
      )
    ) {
      throw new Error(`traceability_audit_proof_unproved: ${layer}`);
    }
  }
  validateLivePackagedSmokeBinding(
    repositoryRoot,
    bindings["packaged-api-mcp-smoke"],
  );
}
