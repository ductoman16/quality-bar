/** @param {unknown} value @returns {value is Record<string, any>} */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @param {unknown} actual @param {unknown} expected @param {string} field */
function requireExact(actual, expected, field) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`traceability_audit_${field}_stale`);
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

/** @param {Record<string, any>} marker @param {any[]} owners */
export function validateTraceabilityResolution(marker, owners) {
  for (const contract of marker.specification.source_contracts) {
    const sourceOwners = owners.filter((owner) =>
      owner.sources.includes(contract.id),
    );
    for (const scenario of contract.scenarios) {
      if (!sourceOwners.some((owner) => owner.scenarios.includes(scenario))) {
        throw new Error(
          `traceability_audit_requirement_scenario_missing: ${contract.id}`,
        );
      }
    }
    if (!isRecord(contract.proof_owners)) {
      throw new Error("traceability_audit_requirement_proof_owners_missing");
    }
    requireExact(
      Object.keys(contract.proof_owners).sort(),
      [...contract.proof].sort(),
      "requirement_proof_owners",
    );
    for (const layer of contract.proof) {
      const proofOwners = positiveTicketArray(
        contract.proof_owners[layer],
        "requirement_proof_owners",
      );
      if (new Set(proofOwners).size !== proofOwners.length) {
        throw new Error(
          `traceability_audit_requirement_proof_owners_conflict: ${contract.id}`,
        );
      }
      const sourceOwnerTickets = new Set(
        sourceOwners.map((owner) => owner.ticket),
      );
      if (
        proofOwners.some(
          (ticket) =>
            !sourceOwnerTickets.has(ticket) ||
            !owners.some(
              (owner) => owner.ticket === ticket && owner.proof.includes(layer),
            ),
        )
      ) {
        throw new Error(
          `traceability_audit_requirement_proof_owner_stale: ${contract.id}`,
        );
      }
    }
  }
}
