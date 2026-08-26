import assert from "node:assert/strict";

export function assertForgejoSiblingRecovery(core: any) {
  assert.deepEqual(
    core.all(
      `SELECT repositories.id, repositories.lifecycle, repositories.health,
              repositories.health_error_code,
              repositories.health_error_message, repositories.verified_at,
              forgejo_repositories.verification_id
       FROM repositories
       JOIN forgejo_repositories
         ON forgejo_repositories.repository_id = repositories.id
       ORDER BY repositories.id`,
    ),
    [
      {
        health: "healthy",
        health_error_code: null,
        health_error_message: null,
        id: "repository-1",
        lifecycle: "enabled",
        verification_id: "verification-8",
        verified_at: 2_000,
      },
      {
        health: "healthy",
        health_error_code: null,
        health_error_message: null,
        id: "repository-2",
        lifecycle: "enabled",
        verification_id: "verification-8",
        verified_at: 1_000,
      },
    ],
  );
}

export function assertForgejoMultipleRepositoryFailure(core: any) {
  assert.deepEqual(
    core.all(
      `SELECT repositories.id, repositories.health,
              repositories.health_error_code,
              repositories.health_error_message,
              forgejo_repositories.verification_id
       FROM repositories
       JOIN forgejo_repositories
         ON forgejo_repositories.repository_id = repositories.id
       ORDER BY repositories.id`,
    ),
    ["repository-1", "repository-2"].map((id) => ({
      health: "error",
      health_error_code: "forgejo_repository_permission_denied",
      health_error_message: "Repositories are forbidden",
      id,
      verification_id: "verification-4",
    })),
  );
  assert.deepEqual(
    core.all(
      `SELECT forge_repository_id, baseline_status, error_code, error_message
       FROM forgejo_repository_polls ORDER BY forge_repository_id`,
    ),
    [11, 22].map((forgeRepositoryId) => ({
      baseline_status: "error",
      error_code: "forgejo_repository_permission_denied",
      error_message: "Repositories are forbidden",
      forge_repository_id: forgeRepositoryId,
    })),
  );
}
