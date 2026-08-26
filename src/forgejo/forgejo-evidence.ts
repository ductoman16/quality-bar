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

export type ForgejoVerificationEvidence = {
  capabilities: Record<string, string> | null;
  principal: { id: number; login: string } | null;
  profile: string | null;
  reported_version: string | null;
  repositories: any[];
  scopes: string[] | null;
};

export function createForgejoVerificationEvidence(
  repositoryIds: number[] | undefined,
): ForgejoVerificationEvidence {
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

export function beginForgejoCapabilityEvidence(
  evidence: ForgejoVerificationEvidence,
) {
  evidence.capabilities = Object.fromEntries(
    FORGEJO_CAPABILITY_NAMES.map((name) => [name, "not_completed"]),
  );
  evidence.profile = "forgejo";
  evidence.scopes = [...VERIFIED_FORGEJO_AUTHORITIES];
}

export function throwWithForgejoEvidence(
  error: unknown,
  evidence: ForgejoVerificationEvidence,
) {
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
