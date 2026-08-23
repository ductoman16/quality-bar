export const VERIFIED_FORGEJO_AUTHORITIES = Object.freeze([
  "read:repository",
  "write:issue",
  "write:repository",
]);

export const FORGEJO_CAPABILITY_NAMES = Object.freeze([
  "aggregate_feedback",
  "branch_access",
  "commit_status",
  "enumeration",
  "inline_feedback",
  "private_git_read",
  "pull_request_access",
]);

/**
 * @typedef {{
 *   capabilities: Record<string, string> | null,
 *   principal: {id: number, login: string} | null,
 *   profile: string | null,
 *   reported_version: string | null,
 *   repositories: any[],
 *   scopes: string[] | null
 * }} ForgejoVerificationEvidence
 */

/** @param {number[] | undefined} repositoryIds @returns {ForgejoVerificationEvidence} */
export function createForgejoVerificationEvidence(repositoryIds) {
  return {
    capabilities: null,
    principal: null,
    profile: null,
    reported_version: null,
    repositories:
      repositoryIds?.map((repositoryId) => ({
        forge_repository_id: repositoryId,
        outcome: "not_completed",
      })) ?? [],
    scopes: null,
  };
}

/** @param {ForgejoVerificationEvidence} evidence */
export function beginForgejoCapabilityEvidence(evidence) {
  evidence.capabilities = Object.fromEntries(
    FORGEJO_CAPABILITY_NAMES.map((name) => [name, "not_completed"]),
  );
  evidence.profile = "forgejo-v16";
  evidence.scopes = [...VERIFIED_FORGEJO_AUTHORITIES];
}

/** @param {unknown} error @param {ForgejoVerificationEvidence} evidence */
export function throwWithForgejoEvidence(error, evidence) {
  if (
    !(error instanceof Error) ||
    !("code" in error) ||
    typeof error.code !== "string"
  ) {
    throw error;
  }
  throw Object.assign(error, {
    repositoryChecks: evidence.repositories,
    verificationEvidence: evidence,
  });
}
