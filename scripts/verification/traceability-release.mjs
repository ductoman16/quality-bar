const EXPECTED_RELEASE_PROOF = ["paid-codex-canary", "private-github-canary"];

/** @param {unknown} actual @param {unknown} expected @param {string} field */
function requireExact(actual, expected, field) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`traceability_audit_${field}_stale`);
  }
}

/** @param {Record<string, any>} marker */
export function validateTraceabilityRelease(marker) {
  const release = marker.release_acceptance;
  if (
    typeof release !== "object" ||
    release === null ||
    Array.isArray(release)
  ) {
    throw new Error("traceability_audit_release_acceptance_missing");
  }
  requireExact(release.proof, EXPECTED_RELEASE_PROOF, "release_proof");
  requireExact(release.owners, [125, 126], "release_owners");
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
