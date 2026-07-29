import assert from "node:assert/strict";

/** @param {any} core */
export function assertForgejoSiblingRecovery(core) {
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
