import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { QUALITY_BAR_EXPECTED_PACKAGED_API_MCP_SMOKE } from "./verification-contract.mjs";

/** @param {unknown} actual @param {unknown} expected @param {string} field */
function requireExact(actual, expected, field) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`traceability_audit_${field}_stale`);
  }
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
      paths.some(
        (path) =>
          typeof path !== "string" ||
          !existsSync(resolve(repositoryRoot, path)),
      )
    ) {
      throw new Error(`traceability_audit_proof_unproved: ${layer}`);
    }
  }
  requireExact(
    implementations["packaged-api-mcp-smoke"],
    [QUALITY_BAR_EXPECTED_PACKAGED_API_MCP_SMOKE.path],
    "proof_implementations",
  );
}
