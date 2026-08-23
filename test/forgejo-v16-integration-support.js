import assert from "node:assert/strict";
import { createForgejoConnectionService } from "../src/forgejo/forgejo-connection.js";
import { forgejoAutomaticEvaluationTestDependencies } from "./storage-reserve-support.js";

/** @param {any} core @param {any} options */
export function createAvailableForgejoConnectionService(core, options) {
  return createForgejoConnectionService(core, {
    ...forgejoAutomaticEvaluationTestDependencies,
    ...options,
  });
}

/** @param {any} verifier @param {string} baseUrl */
export async function assertForgejoMissingRepositoryId(verifier, baseUrl) {
  await assert.rejects(
    verifier.verify({
      baseUrl,
      repositoryIds: [11, 99],
      token: "operator-created-pat",
    }),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "forgejo_repository_selection_unavailable" &&
      "repositoryId" in error &&
      error.repositoryId === 99,
  );
  await assert.rejects(
    verifier.verify({
      baseUrl,
      repositoryIds: [98, 99],
      token: "operator-created-pat",
    }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.deepEqual(/** @type {any} */ (error).repositoryIds, [98, 99]);
      assert.deepEqual(
        /** @type {any} */ (error).verificationEvidence.repositories,
        [98, 99].map((repositoryId) => ({
          error: {
            code: "forgejo_repository_selection_unavailable",
            message:
              "Selected Forgejo Repository is not accessible to the Connection",
          },
          forge_repository_id: repositoryId,
          outcome: "error",
        })),
      );
      return true;
    },
  );
}

/** @param {any} verifier @param {string} baseUrl @param {(failure: "capability" | "git" | null) => void} setFailure */
export async function assertForgejoRepositoryFailureOwners(
  verifier,
  baseUrl,
  setFailure,
) {
  for (const [failure, expected] of [
    ["capability", "forgejo_repository_capability_missing"],
    ["git", "repository_git_read_failed"],
  ]) {
    setFailure(/** @type {"capability" | "git"} */ (failure));
    await assert.rejects(
      verifier.verify({
        baseUrl,
        repositoryIds: [11],
        token: "operator-created-pat",
      }),
      { code: expected, repositoryId: 11 },
    );
  }
  setFailure(null);
}

export const incompleteForgejoCapabilities = {
  aggregate_feedback: "not_completed",
  branch_access: "error",
  commit_status: "verified",
  enumeration: "verified",
  inline_feedback: "verified",
  private_git_read: "not_completed",
  pull_request_access: "not_completed",
};

const routeError = {
  code: "forgejo_repository_permission_denied",
  message:
    "Forgejo verification route failed with HTTP 403: /api/v1/repos/operator/private/branches",
};

/** @param {any} failure */
export function assertForgejoPartialFailure(failure) {
  assert.deepEqual(failure?.repositoryChecks, [
    {
      api_url: "https://forgejo.example/api/v1/repos/operator/private",
      clone_url: "https://forgejo.example/operator/private.git",
      full_name: "operator/private",
      html_url: "https://forgejo.example/operator/private",
      id: 11,
      outcome: "success",
      permissions: { admin: true, pull: true, push: true },
      private: true,
    },
    {
      error: {
        code: "forgejo_repository_permission_denied",
        message:
          "Forgejo verification route failed with HTTP 403: /api/v1/repos/operator/private-2/branches",
      },
      forge_repository_id: 12,
      outcome: "error",
      permissions: { admin: true, pull: true, push: true },
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
        error_code: "forgejo_repository_permission_denied",
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
        permissions: { admin: true, pull: true, push: true },
      },
    ],
    scopes: ["read:repository", "write:issue", "write:repository"],
    trigger: "enablement",
    verified_at: 1_006,
  });
}

/** @param {any} core */
export function assertForgejoFailedReactivationRepository(core) {
  assert.deepEqual(
    core.get("SELECT health, health_error_code FROM repositories"),
    {
      health: "error",
      health_error_code: "forgejo_repository_permission_denied",
    },
  );
}
