import assert from "node:assert/strict";

export const incompleteForgejoCapabilities = {
  aggregate_feedback: "not_completed",
  branch_access: "not_completed",
  commit_status: "not_completed",
  enumeration: "verified",
  inline_feedback: "not_completed",
  private_git_read: "not_completed",
  pull_request_access: "not_completed",
};

const routeError = {
  code: "forgejo_required_route_unavailable",
  message:
    "Forgejo required route is unavailable: /api/v1/repos/operator/private/branches",
};

/** @param {any} failure */
export function assertForgejoPartialFailure(failure) {
  assert.deepEqual(failure?.repositoryChecks, [
    { forge_repository_id: 11, outcome: "success" },
    {
      error: {
        code: "forgejo_required_route_unavailable",
        message:
          "Forgejo required route is unavailable: /api/v1/repos/operator/private-2/branches",
      },
      forge_repository_id: 12,
      outcome: "error",
    },
  ]);
  assert.deepEqual(failure?.verificationEvidence, {
    capabilities: incompleteForgejoCapabilities,
    principal: { id: 7, login: "operator" },
    profile: "forgejo-v16",
    reported_version: "16.0.4",
    repositories: failure.repositoryChecks,
    scopes: ["read:repository", "write:issue", "write:repository"],
  });
}

/** @param {any} core */
export function assertForgejoVerificationRows(core) {
  assert.deepEqual(
    core.all(
      "SELECT id, trigger, error_code FROM forgejo_connection_verifications ORDER BY verified_at",
    ),
    [
      { error_code: null, id: "verification-1", trigger: "onboarding" },
      { error_code: null, id: "verification-2", trigger: "rotation" },
      {
        error_code: "forgejo_required_route_unavailable",
        id: "verification-3",
        trigger: "enablement",
      },
      { error_code: null, id: "verification-4", trigger: "enablement" },
    ],
  );
}

/** @param {any} verification */
export function assertForgejoFailedReactivationHistory(verification) {
  assert.deepEqual(verification, {
    api_profile: "forgejo-v16",
    capabilities: incompleteForgejoCapabilities,
    error: routeError,
    id: "verification-3",
    outcome: "error",
    principal: { id: 7, login: "operator" },
    reported_version: "16.0.4",
    repositories: [
      {
        error: routeError,
        forge_repository_id: 11,
        outcome: "error",
      },
    ],
    scopes: ["read:repository", "write:issue", "write:repository"],
    trigger: "enablement",
    verified_at: 1_002,
  });
}
