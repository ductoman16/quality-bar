import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  QUALITY_BAR_ACCEPTANCE_SCENARIOS,
  QUALITY_BAR_EXPECTED_EVIDENCE_FIELDS,
  QUALITY_BAR_SOURCE_CONTRACTS,
  QUALITY_BAR_SPECIFICATION_PARENT,
  QUALITY_BAR_VERIFICATION_PROOF,
  QUALITY_BAR_VERIFICATION_SOURCES,
} from "./verification-contract.mjs";
import { validateTraceabilityProofs } from "./traceability-proof.mjs";
import { validateTraceabilityRelease } from "./traceability-release.mjs";
import { validateTraceabilityResolution } from "./traceability-resolution.mjs";

export const TRACEABILITY_OWNERSHIP_PATH =
  "evidence/quality-foundation/issue-127-traceability.json";

const EXPECTED_SOURCES = [...Array(23).keys()].map((index) => `#${index + 2}`);
const EXPECTED_PROOF_LAYERS = [
  "adapter-integration",
  "browser-component",
  "evidence-manifest",
  "fake-codex-integration",
  "forgejo-fixture-integration",
  "forgejo-v16-integration",
  "git-integration",
  "github-fixture-integration",
  "http-integration",
  "http-openapi-integration",
  "mcp-integration",
  "operator-browser-smoke",
  "package-integration",
  "packaged-api-mcp-smoke",
  "paid-codex-canary",
  "private-github-canary",
  "process-integration",
  "security-integration",
  "sqlite-failure-integration",
  "sqlite-integration",
  "unit",
  "verification-gate",
];
const EXPECTED_MANIFEST_PATHS = new Set([
  "sourceCommit",
  "platform",
  "componentVersions",
  "runnerVersions",
  "securityBoundary",
  "invokedGates",
  "invokedGates[].testGroups",
  "invokedGates[].durationMs",
  "invokedGates[].facts",
  "totalDurationMs",
  "outcome",
  "failures",
  "performance",
  "releaseCanaries",
]);

/**
 * @typedef {{
 *   marker: string,
 *   parent: number,
 *   sourceContracts: string[],
 *   acceptanceScenarios: string[],
 *   proofLayers: string[],
 *   evidenceFields: string[],
 *   ownerCount: number,
 *   releaseAcceptance: {proof: string[], owners: number[]},
 * }} TraceabilityAudit
 */

/** @param {unknown} value @returns {value is Record<string, any>} */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @param {unknown} value @param {string} field */
function requiredArray(value, field) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`traceability_audit_${field}_missing`);
  }
  if (value.some((entry) => typeof entry !== "string" || entry.length === 0)) {
    throw new Error(`traceability_audit_${field}_invalid`);
  }
  if (new Set(value).size !== value.length) {
    throw new Error(`traceability_audit_${field}_duplicate`);
  }
  return [...value];
}

/** @param {unknown} actual @param {unknown} expected @param {string} field */
function requireExact(actual, expected, field) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`traceability_audit_${field}_stale`);
  }
}

/** @param {string[]} values @param {readonly string[]} expected @param {string} errorCode */
function requireKnownValues(values, expected, errorCode) {
  if (values.some((value) => !expected.includes(value))) {
    throw new Error(errorCode);
  }
}

/** @param {string} repositoryRoot @returns {Record<string, any>} */
export function readTraceabilityOwnership(repositoryRoot) {
  try {
    const marker = JSON.parse(
      readFileSync(
        resolve(repositoryRoot, TRACEABILITY_OWNERSHIP_PATH),
        "utf8",
      ),
    );
    if (!isRecord(marker)) {
      throw new Error("traceability_audit_marker_invalid");
    }
    return marker;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "traceability_audit_marker_invalid"
    ) {
      throw error;
    }
    throw new Error(
      `traceability_audit_marker_unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/** @param {unknown} value @param {string} field */
function positiveTicketArray(value, field) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((ticket) => !Number.isSafeInteger(ticket) || ticket <= 0)
  ) {
    throw new Error(`traceability_audit_${field}_invalid`);
  }
  return [...value];
}

/** @param {Record<string, any>} marker */
function validateIdentity(marker) {
  if (
    marker.ticket !== 127 ||
    marker.parent !== QUALITY_BAR_SPECIFICATION_PARENT
  ) {
    throw new Error("traceability_audit_identity_stale");
  }
  requireExact(
    requiredArray(marker.sources, "sources"),
    QUALITY_BAR_VERIFICATION_SOURCES,
    "sources",
  );
  requireExact(
    requiredArray(marker.acceptance_scenarios, "acceptance_scenarios"),
    QUALITY_BAR_ACCEPTANCE_SCENARIOS,
    "acceptance_scenarios",
  );
  requireExact(
    requiredArray(marker.proof, "proof"),
    QUALITY_BAR_VERIFICATION_PROOF,
    "proof",
  );
  if (marker.final_outcome !== "pass") {
    throw new Error("traceability_audit_outcome_invalid");
  }
}

/** @param {Record<string, any>} marker */
function validateSpecification(marker) {
  const specification = marker.specification;
  const sourceContracts = specification?.source_contracts;
  if (!isRecord(specification) || !Array.isArray(sourceContracts)) {
    throw new Error("traceability_audit_specification_missing");
  }
  requireExact(
    sourceContracts.map((contract) => contract?.id),
    EXPECTED_SOURCES,
    "requirements",
  );
  requireExact(
    sourceContracts.map((contract) => ({
      id: contract?.id,
      section: contract?.section,
      scenarios: contract?.scenarios,
      proof: contract?.proof,
      evidence: contract?.evidence,
      proof_owners: contract?.proof_owners,
    })),
    QUALITY_BAR_SOURCE_CONTRACTS,
    "requirements",
  );
  for (const contract of sourceContracts) {
    if (
      !isRecord(contract) ||
      typeof contract.section !== "string" ||
      typeof contract.evidence !== "string"
    ) {
      throw new Error("traceability_audit_requirement_invalid");
    }
    requireKnownValues(
      requiredArray(contract.scenarios, "requirement_scenarios"),
      QUALITY_BAR_ACCEPTANCE_SCENARIOS,
      "traceability_audit_requirement_stale",
    );
    requireKnownValues(
      requiredArray(contract.proof, "requirement_proof"),
      EXPECTED_PROOF_LAYERS,
      "traceability_audit_requirement_stale",
    );
  }
  requireExact(
    requiredArray(specification.proof_layers, "proof_layers"),
    EXPECTED_PROOF_LAYERS,
    "proof_layers",
  );
  return { sourceContracts, evidenceFields: specification.evidence_fields };
}

/** @param {Record<string, any>} marker */
function validateOwners(marker) {
  const owners = marker.ownership_markers;
  const implemented = marker.implemented_owners;
  if (!Array.isArray(owners) || owners.length === 0) {
    throw new Error("traceability_audit_owners_missing");
  }
  if (!Array.isArray(implemented) || implemented.length === 0) {
    throw new Error("traceability_audit_implemented_owners_missing");
  }
  const implementedByTicket = new Map();
  for (const owner of implemented) {
    if (
      !isRecord(owner) ||
      !Number.isSafeInteger(owner.ticket) ||
      typeof owner.key !== "string" ||
      implementedByTicket.has(owner.ticket)
    ) {
      throw new Error("traceability_audit_implemented_owner_invalid");
    }
    implementedByTicket.set(owner.ticket, owner.key);
  }
  const ownerTickets = new Set();
  const ownerKeys = new Set();
  for (const owner of owners) {
    if (
      !isRecord(owner) ||
      !Number.isSafeInteger(owner.ticket) ||
      owner.ticket <= 0
    ) {
      throw new Error("traceability_audit_owner_invalid");
    }
    if (owner.ticket === 127 || owner.ticket < 26 || owner.ticket > 134) {
      throw new Error("traceability_audit_owner_stale");
    }
    if (ownerTickets.has(owner.ticket) || ownerKeys.has(owner.key)) {
      throw new Error("traceability_audit_duplicate_conflict");
    }
    ownerTickets.add(owner.ticket);
    ownerKeys.add(owner.key);
    if (implementedByTicket.get(owner.ticket) !== owner.key) {
      throw new Error("traceability_audit_owner_stale");
    }
    requireKnownValues(
      requiredArray(owner.sources, "owner_sources"),
      EXPECTED_SOURCES,
      "traceability_audit_owner_stale",
    );
    requireKnownValues(
      requiredArray(owner.scenarios, "owner_scenarios"),
      QUALITY_BAR_ACCEPTANCE_SCENARIOS,
      "traceability_audit_owner_stale",
    );
    requireKnownValues(
      requiredArray(owner.proof, "owner_proof"),
      EXPECTED_PROOF_LAYERS,
      "traceability_audit_owner_stale",
    );
  }
  if (
    implementedByTicket.size !== ownerTickets.size ||
    [...implementedByTicket].some(
      ([ticket, key]) => !ownerTickets.has(ticket) || !ownerKeys.has(key),
    )
  ) {
    throw new Error("traceability_audit_owner_stale");
  }
  return owners;
}

/** @param {Record<string, any>} marker @param {any[]} owners */
function validateCoverage(marker, owners) {
  for (const contract of marker.specification.source_contracts) {
    if (!owners.some((owner) => owner.sources.includes(contract.id))) {
      throw new Error(`traceability_audit_requirement_missing: ${contract.id}`);
    }
  }
  for (const scenario of QUALITY_BAR_ACCEPTANCE_SCENARIOS) {
    if (!owners.some((owner) => owner.scenarios.includes(scenario))) {
      throw new Error(`traceability_audit_scenario_missing: ${scenario}`);
    }
  }
  for (const layer of EXPECTED_PROOF_LAYERS) {
    if (!owners.some((owner) => owner.proof.includes(layer))) {
      throw new Error(`traceability_audit_proof_unproved: ${layer}`);
    }
  }
}

/** @param {Record<string, any>} marker */
function validateEvidenceFields(marker) {
  const fields = marker.specification.evidence_fields;
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new Error("traceability_audit_evidence_fields_missing");
  }
  requireExact(
    fields.map((field) => ({ id: field?.id, path: field?.path })),
    QUALITY_BAR_EXPECTED_EVIDENCE_FIELDS,
    "evidence_fields",
  );
  const implemented = new Set(
    marker.implemented_owners.map(
      /** @param {any} owner */
      (owner) => owner.ticket,
    ),
  );
  const ids = new Set();
  for (const field of fields) {
    if (
      !isRecord(field) ||
      typeof field.id !== "string" ||
      typeof field.path !== "string" ||
      !EXPECTED_MANIFEST_PATHS.has(field.path) ||
      ids.has(field.id)
    ) {
      throw new Error("traceability_audit_evidence_field_stale");
    }
    ids.add(field.id);
    if (
      positiveTicketArray(field.owners, "evidence_field_owners").some(
        (ticket) => !implemented.has(ticket),
      )
    ) {
      throw new Error("traceability_audit_evidence_field_stale");
    }
  }
  return fields;
}

/**
 * @param {{repositoryRoot?: string}} [options]
 * @returns {TraceabilityAudit}
 */
export function auditTraceability({
  repositoryRoot = resolve(import.meta.dirname, "../.."),
} = {}) {
  const marker = readTraceabilityOwnership(repositoryRoot);
  validateIdentity(marker);
  const { sourceContracts } = validateSpecification(marker);
  const owners = validateOwners(marker);
  validateCoverage(marker, owners);
  validateTraceabilityResolution(marker, owners);
  const evidenceFields = validateEvidenceFields(marker);
  validateTraceabilityProofs({
    marker,
    proofLayers: EXPECTED_PROOF_LAYERS,
    repositoryRoot,
  });
  validateTraceabilityRelease(marker);
  return {
    marker: TRACEABILITY_OWNERSHIP_PATH,
    parent: QUALITY_BAR_SPECIFICATION_PARENT,
    sourceContracts: sourceContracts.map((contract) => contract.id),
    acceptanceScenarios: [...QUALITY_BAR_ACCEPTANCE_SCENARIOS],
    proofLayers: [...EXPECTED_PROOF_LAYERS],
    evidenceFields: evidenceFields.map((field) => field.id),
    ownerCount: owners.length,
    releaseAcceptance: {
      proof: ["paid-codex-canary", "private-github-canary"],
      owners: [125, 126],
    },
  };
}
