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

export function neverUsedForgejoConnection() {
  return {
    ...validForgejoConnection,
    verification_history: validForgejoConnection.verification_history.map(
      (verification) => ({ ...verification, repositories: [] }),
    ),
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

/** @param {Map<string, any>} controls */
export function assertFailedForgejoReactivationState(controls) {
  const lifecycle = controls.get("forgejo-connection-lifecycle");
  const health = controls.get("forgejo-connection-health");
  const history = controls.get("forgejo-connection-history");
  const error = controls.get("forgejo-connection-error");
  const profile = controls.get("forgejo-connection-profile");
  const token = controls.get("forgejo-connection-reactivation-token");
  const submit = controls.get("forgejo-connection-reactivation-submit");
  assert.equal(lifecycle.textContent, "Retired");
  assert.match(health.textContent, /Replacement PAT verification failed/);
  assert.equal(history.children.length, 2);
  assert.equal(error.textContent, "Replacement PAT verification failed");
  assert.match(profile.textContent, /Last successful profile/);
  assert.doesNotMatch(profile.textContent, /compatible/);
  assert.equal(token.value, "failed-reactivation-pat");
  assert.equal(submit.disabled, false);
}
