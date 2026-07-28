import assert from "node:assert/strict";

export const validForgejoConnection = {
  api_profile: "forgejo-v16",
  base_url: "https://forgejo.example",
  capabilities: { private_git_read: "verified" },
  health: "healthy",
  health_error: null,
  id: "forgejo-connection",
  lifecycle: "enabled",
  principal: { id: 7, login: "operator" },
  reported_version: "16.0.4",
  scopes: ["read:repository", "write:issue", "write:repository"],
  verification_history: [
    {
      api_profile: "forgejo-v16",
      capabilities: { private_git_read: "verified" },
      error: null,
      id: "verification-1",
      outcome: "success",
      principal: { id: 7, login: "operator" },
      reported_version: "16.0.4",
      repositories: [{ full_name: "operator/private", id: 11, private: true }],
      scopes: ["read:repository", "write:issue", "write:repository"],
      trigger: "onboarding",
      verified_at: 1_000,
    },
  ],
  verified_at: 1_000,
};

export function failedForgejoReactivation() {
  return {
    ...validForgejoConnection,
    health: "error",
    health_error: {
      code: "forgejo_verification_failed",
      message: "Replacement PAT verification failed",
    },
    lifecycle: "retired",
    verification_history: [
      ...validForgejoConnection.verification_history,
      {
        api_profile: null,
        capabilities: null,
        error: {
          code: "forgejo_verification_failed",
          message: "Replacement PAT verification failed",
        },
        id: "verification-2",
        outcome: "error",
        principal: null,
        reported_version: null,
        repositories: [{ forge_repository_id: 11, outcome: "not_completed" }],
        scopes: null,
        trigger: "enablement",
        verified_at: 2_000,
      },
    ],
    verified_at: 2_000,
  };
}

/** @param {any} contract */
export async function assertForgejoContract(contract) {
  assert.equal(
    await contract.forgejoResponseErrorMessage({
      async json() {
        return { error: { message: "Exact lifecycle conflict" } };
      },
    }),
    "Exact lifecycle conflict",
  );
  await assert.rejects(
    () =>
      contract.forgejoResponseErrorMessage({
        async json() {
          return { error: {} };
        },
      }),
    /Forgejo error response is invalid/,
  );
  assert.equal(
    contract.forgejoErrorMessage(new Error("Exact browser failure")),
    "Exact browser failure",
  );
  assert.throws(
    () => contract.forgejoErrorMessage("unexpected thrown value"),
    (error) => error === "unexpected thrown value",
  );
  assert.match(
    contract.forgejoVerificationText({
      error: { code: "forgejo_failed", message: "Forgejo failed" },
      outcome: "error",
      repositories: [],
      trigger: "enablement",
      verified_at: 2_000,
    }),
    /Forgejo failed \(forgejo_failed\)/,
  );
}
