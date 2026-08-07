import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const TRACEABILITY_OWNERSHIP_PATH =
  "evidence/quality-foundation/issue-127-traceability.json";

const EXPECTED_PARENT = 25;
const EXPECTED_SOURCES = [...Array(23).keys()].map((index) => `#${index + 2}`);
const EXPECTED_SCENARIOS = [...Array(10).keys()].map(
  (index) => `ACC-${String(index + 1).padStart(2, "0")}`,
);
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
  "performance",
  "releaseCanaries",
]);
const EXPECTED_EVIDENCE_FIELDS = [
  { id: "source-commit", path: "sourceCommit" },
  { id: "platform", path: "platform" },
  { id: "component-versions", path: "componentVersions" },
  { id: "runner-versions", path: "runnerVersions" },
  { id: "security-boundary", path: "securityBoundary" },
  { id: "invoked-gates", path: "invokedGates" },
  { id: "test-group-counts", path: "invokedGates[].testGroups" },
  { id: "gate-durations", path: "invokedGates[].durationMs" },
  { id: "gate-facts", path: "invokedGates[].facts" },
  { id: "total-duration", path: "totalDurationMs" },
  { id: "performance-facts", path: "performance" },
  { id: "release-canaries", path: "releaseCanaries" },
];
const EXPECTED_RELEASE_PROOF = ["paid-codex-canary", "private-github-canary"];

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

/** @param {string[]} actual @param {string[]} expected @param {string} field */
function requireExact(actual, expected, field) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`traceability_audit_${field}_stale`);
  }
}

/** @param {unknown} actual @param {unknown} expected @param {string} field */
function requireExactJson(actual, expected, field) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`traceability_audit_${field}_stale`);
  }
}

/** @param {string} repositoryRoot @returns {Record<string, any>} */
export function readTraceabilityOwnership(repositoryRoot) {
  const markerPath = resolve(repositoryRoot, TRACEABILITY_OWNERSHIP_PATH);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(markerPath, "utf8"));
  } catch (error) {
    throw new Error(
      `traceability_audit_marker_unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (!isRecord(parsed)) {
    throw new Error("traceability_audit_marker_invalid");
  }
  return parsed;
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
  if (marker.ticket !== 127 || marker.parent !== EXPECTED_PARENT) {
    throw new Error("traceability_audit_identity_stale");
  }
  requireExact(
    requiredArray(marker.sources, "sources"),
    ["#21", "#22"],
    "sources",
  );
  requireExact(
    requiredArray(marker.acceptance_scenarios, "acceptance_scenarios"),
    EXPECTED_SCENARIOS,
    "acceptance_scenarios",
  );
  requireExact(
    requiredArray(marker.proof, "proof"),
    ["verification-gate", "evidence-manifest"],
    "proof",
  );
  if (marker.final_outcome !== "pass") {
    throw new Error("traceability_audit_outcome_invalid");
  }
}

/** @param {Record<string, any>} marker */
function validateSpecification(marker) {
  const specification = marker.specification;
  if (!isRecord(specification)) {
    throw new Error("traceability_audit_specification_missing");
  }
  const sourceContracts = specification.source_contracts;
  if (!Array.isArray(sourceContracts) || sourceContracts.length === 0) {
    throw new Error("traceability_audit_requirements_missing");
  }
  const sourceIds = sourceContracts.map((contract) => contract?.id);
  requireExact(sourceIds, EXPECTED_SOURCES, "requirements");
  for (const contract of sourceContracts) {
    if (
      !isRecord(contract) ||
      typeof contract.section !== "string" ||
      contract.section.length === 0 ||
      typeof contract.evidence !== "string" ||
      contract.evidence.length === 0
    ) {
      throw new Error("traceability_audit_requirement_invalid");
    }
    const scenarios = requiredArray(
      contract.scenarios,
      "requirement_scenarios",
    );
    if (scenarios.some((scenario) => !EXPECTED_SCENARIOS.includes(scenario))) {
      throw new Error("traceability_audit_requirement_stale");
    }
    const proof = requiredArray(contract.proof, "requirement_proof");
    if (proof.some((layer) => !EXPECTED_PROOF_LAYERS.includes(layer))) {
      throw new Error("traceability_audit_requirement_stale");
    }
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
      typeof owner.key !== "string"
    ) {
      throw new Error("traceability_audit_implemented_owner_invalid");
    }
    if (implementedByTicket.has(owner.ticket)) {
      throw new Error("traceability_audit_duplicate_owner");
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
    const sources = requiredArray(owner.sources, "owner_sources");
    if (sources.some((source) => !EXPECTED_SOURCES.includes(source))) {
      throw new Error("traceability_audit_owner_stale");
    }
    const scenarios = requiredArray(owner.scenarios, "owner_scenarios");
    if (scenarios.some((scenario) => !EXPECTED_SCENARIOS.includes(scenario))) {
      throw new Error("traceability_audit_owner_stale");
    }
    const proof = requiredArray(owner.proof, "owner_proof");
    if (proof.some((layer) => !EXPECTED_PROOF_LAYERS.includes(layer))) {
      throw new Error("traceability_audit_owner_stale");
    }
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
  const specification = marker.specification;
  for (const contract of specification.source_contracts) {
    if (!owners.some((owner) => owner.sources.includes(contract.id))) {
      throw new Error(`traceability_audit_requirement_missing: ${contract.id}`);
    }
  }
  for (const scenario of EXPECTED_SCENARIOS) {
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
  requireExactJson(
    fields.map((field) => ({ id: field?.id, path: field?.path })),
    EXPECTED_EVIDENCE_FIELDS,
    "evidence_fields",
  );
  const ids = new Set();
  const implemented = new Set(
    marker.implemented_owners.map(
      /** @param {any} owner */
      (owner) => owner.ticket,
    ),
  );
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
    const owners = positiveTicketArray(field.owners, "evidence_field_owners");
    if (owners.some((ticket) => !implemented.has(ticket))) {
      throw new Error("traceability_audit_evidence_field_stale");
    }
  }
  return fields;
}

/** @param {Record<string, any>} marker @param {string} repositoryRoot */
function validateProofImplementations(marker, repositoryRoot) {
  const implementations = marker.proof_implementations;
  if (!isRecord(implementations)) {
    throw new Error("traceability_audit_proof_implementations_missing");
  }
  requireExact(
    Object.keys(implementations).sort(),
    [...EXPECTED_PROOF_LAYERS].sort(),
    "proof_implementations",
  );
  for (const layer of EXPECTED_PROOF_LAYERS) {
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
}

/** @param {Record<string, any>} marker */
function validateReleaseAcceptance(marker) {
  const release = marker.release_acceptance;
  if (!isRecord(release)) {
    throw new Error("traceability_audit_release_acceptance_missing");
  }
  requireExact(release.proof, EXPECTED_RELEASE_PROOF, "release_proof");
  requireExactJson(release.owners, [125, 126], "release_owners");
  requireExact(
    release.manifest_paths,
    ["releaseCanaries.paidCodex", "releaseCanaries.privateGitHub"],
    "release_manifest_paths",
  );
  if (
    !Array.isArray(release.routine_gate_membership) ||
    release.routine_gate_membership.length !== 0 ||
    release.new_e2e_scenarios !== 0
  ) {
    throw new Error("traceability_audit_release_scope_invalid");
  }
  for (const [ticket, proof] of [
    [125, "paid-codex-canary"],
    [126, "private-github-canary"],
  ]) {
    const owner = marker.ownership_markers.find(
      /** @param {any} candidate */
      (candidate) => candidate.ticket === ticket,
    );
    if (!owner || JSON.stringify(owner.proof) !== JSON.stringify([proof])) {
      throw new Error("traceability_audit_release_owner_unproved");
    }
  }
}

/**
 * @param {{repositoryRoot?: string}} [options]
 * @returns {{marker: string, parent: number, sourceContracts: string[], acceptanceScenarios: string[], proofLayers: string[], evidenceFields: string[], ownerCount: number, releaseAcceptance: {proof: string[], owners: number[]}}}
 */
export function auditTraceability({
  repositoryRoot = resolve(import.meta.dirname, "../.."),
} = {}) {
  const marker = readTraceabilityOwnership(repositoryRoot);
  validateIdentity(marker);
  const { sourceContracts } = validateSpecification(marker);
  const owners = validateOwners(marker);
  validateCoverage(marker, owners);
  const evidenceFields = validateEvidenceFields(marker);
  validateProofImplementations(marker, repositoryRoot);
  validateReleaseAcceptance(marker);
  return {
    marker: TRACEABILITY_OWNERSHIP_PATH,
    parent: EXPECTED_PARENT,
    sourceContracts: sourceContracts.map((contract) => contract.id),
    acceptanceScenarios: [...EXPECTED_SCENARIOS],
    proofLayers: [...EXPECTED_PROOF_LAYERS],
    evidenceFields: evidenceFields.map((field) => field.id),
    ownerCount: owners.length,
    releaseAcceptance: {
      proof: [...EXPECTED_RELEASE_PROOF],
      owners: [125, 126],
    },
  };
}
