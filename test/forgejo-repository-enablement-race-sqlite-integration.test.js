import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { createForgejoConnectionService } from "../src/forgejo-connection.js";
import { prepareForgejoRepositoryEnablement } from "../src/repository-provider-verification.js";
import { createRepositoryService } from "../src/repository.js";
import {
  forgejoVerification,
  repositoryEvidence,
} from "./forgejo-polling-sqlite-integration-support.js";
import { assertForgejoSiblingRecovery } from "./forgejo-repository-enablement-race-support.js";
import { availableStorageReserve } from "./storage-reserve-support.js";

test("Forgejo Repository re-enablement rejects a stale sibling snapshot atomically", async (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-forgejo-sibling-enable-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  const masterKey = Buffer.alloc(32, 23);
  const evidence = [
    repositoryEvidence(11, "private"),
    repositoryEvidence(22, "sibling"),
  ];
  let siblingFailure = false;
  let conflictingFailure = false;
  let multipleFailure = false;
  let ambiguousFailure = false;
  let newerSiblingHealthAndFailure = false;
  let retireSiblingDuringVerification = false;
  const forgejo = createForgejoConnectionService(core, {
    createId: (() => {
      const ids = [
        "connection-1",
        "verification-1",
        "repository-1",
        "repository-2",
        "verification-2",
        "verification-3",
        "verification-4",
        "verification-5",
        "verification-6",
        "verification-7",
        "verification-8",
      ];
      return () => ids.shift();
    })(),
    masterKey,
    now: () => 1_000,
    storageReserve: availableStorageReserve,
    verifier: {
      async listPullRequests() {
        return [];
      },
      async verify() {
        if (siblingFailure) {
          throw Object.assign(new Error("Sibling Repository is forbidden"), {
            code: "forgejo_repository_permission_denied",
            repositoryId: 22,
          });
        }
        if (conflictingFailure) {
          throw Object.assign(new Error("Private Repository is forbidden"), {
            attemptedAt: 1_500,
            code: "forgejo_repository_permission_denied",
            repositoryChecks: [
              {
                error: {
                  code: "forgejo_repository_permission_denied",
                  message: "Private Repository is forbidden",
                },
                forge_repository_id: 11,
                outcome: "error",
              },
              { forge_repository_id: 22, outcome: "not_completed" },
            ],
            repositoryId: 22,
          });
        }
        if (multipleFailure) {
          throw Object.assign(new Error("Repositories are forbidden"), {
            attemptedAt: 1_500,
            code: "forgejo_repository_permission_denied",
            repositoryChecks: [
              {
                error: {
                  code: "forgejo_repository_permission_denied",
                  message: "Repositories are forbidden",
                },
                forge_repository_id: 11,
                outcome: "error",
              },
              {
                error: {
                  code: "forgejo_repository_permission_denied",
                  message: "Repositories are forbidden",
                },
                forge_repository_id: 22,
                outcome: "error",
              },
            ],
          });
        }
        if (newerSiblingHealthAndFailure) {
          core.run(
            `UPDATE repositories
             SET health = 'error',
                 health_error_code = 'forgejo_poll_response_invalid',
                 health_error_message = 'Newer polling failure',
                 verified_at = 1000
             WHERE id = 'repository-2'`,
          );
          core.run(
            `INSERT INTO quality_bar_metadata (key, value)
             VALUES ('forgejo_poll_generation:connection-1', '1')
             ON CONFLICT (key) DO UPDATE
             SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)`,
          );
          throw Object.assign(new Error("Sibling Repository is forbidden"), {
            code: "forgejo_repository_permission_denied",
            repositoryId: 22,
          });
        }
        if (ambiguousFailure) {
          throw Object.assign(
            new Error("A Forgejo Repository is no longer accessible"),
            { code: "forgejo_repository_selection_unavailable" },
          );
        }
        if (retireSiblingDuringVerification) {
          core.run(
            `UPDATE repositories
             SET lifecycle = 'retired',
                 lifecycle_revision = lifecycle_revision + 1
             WHERE id = 'repository-2'`,
          );
        }
        return forgejoVerification(evidence);
      },
    },
  });
  await forgejo.connect({
    base_url: "https://forgejo.example",
    repository_ids: [11, 22],
    token: "pat",
  });
  const repositories = createRepositoryService(core, {
    masterKey,
    now: () => 2_000,
    verifyForgeRepository: (forgeRepositoryId) =>
      prepareForgejoRepositoryEnablement(forgejo, forgeRepositoryId),
  });
  core.run(
    "UPDATE repositories SET has_been_used = 1 WHERE id = 'repository-1'",
  );
  await repositories.setLifecycle("repository-1", { lifecycle: "retired" });
  core.run(
    `UPDATE forgejo_repository_polls
     SET baseline_status = 'pending', next_attempt_at = 0
     WHERE forge_repository_id = 22`,
  );
  siblingFailure = true;
  await assert.rejects(
    repositories.setLifecycle("repository-1", { lifecycle: "enabled" }),
    {
      code: "forgejo_repository_permission_denied",
      repositoryId: 22,
    },
  );
  assert.deepEqual(
    core.all(
      `SELECT repositories.id, repositories.lifecycle, repositories.health,
              repositories.health_error_code,
              repositories.health_error_message,
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
        lifecycle: "retired",
        verification_id: "verification-1",
      },
      {
        health: "error",
        health_error_code: "forgejo_repository_permission_denied",
        health_error_message: "Sibling Repository is forbidden",
        id: "repository-2",
        lifecycle: "enabled",
        verification_id: "verification-2",
      },
    ],
  );
  siblingFailure = false;
  const beforeAmbiguousOwnership = {
    polling: core.all(
      `SELECT forge_repository_id, baseline_status, error_code, error_message
       FROM forgejo_repository_polls ORDER BY forge_repository_id`,
    ),
    repositories: core.all(
      `SELECT repositories.id, repositories.health,
              repositories.health_error_code,
              repositories.health_error_message,
              forgejo_repositories.verification_id
       FROM repositories
       JOIN forgejo_repositories
         ON forgejo_repositories.repository_id = repositories.id
       ORDER BY repositories.id`,
    ),
  };
  conflictingFailure = true;
  await assert.rejects(
    repositories.setLifecycle("repository-1", { lifecycle: "enabled" }),
    { code: "forgejo_repository_permission_denied" },
  );
  conflictingFailure = false;
  multipleFailure = true;
  await assert.rejects(
    repositories.setLifecycle("repository-1", { lifecycle: "enabled" }),
    { code: "forgejo_repository_permission_denied" },
  );
  multipleFailure = false;
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
    beforeAmbiguousOwnership.repositories,
  );
  assert.deepEqual(
    core.all(
      `SELECT forge_repository_id, baseline_status, error_code, error_message
       FROM forgejo_repository_polls ORDER BY forge_repository_id`,
    ),
    beforeAmbiguousOwnership.polling,
  );
  assert.deepEqual(
    core.all(
      `SELECT id FROM forgejo_connection_verifications
       WHERE id IN ('verification-3', 'verification-4') ORDER BY id`,
    ),
    [{ id: "verification-3" }, { id: "verification-4" }],
  );
  ambiguousFailure = true;
  await assert.rejects(
    repositories.setLifecycle("repository-1", { lifecycle: "enabled" }),
    { code: "forgejo_repository_selection_unavailable" },
  );
  assert.deepEqual(
    core.all(
      `SELECT repositories.id, repositories.lifecycle, repositories.health,
              forgejo_repositories.verification_id
       FROM repositories
       JOIN forgejo_repositories
         ON forgejo_repositories.repository_id = repositories.id
       ORDER BY repositories.id`,
    ),
    [
      {
        health: "healthy",
        id: "repository-1",
        lifecycle: "retired",
        verification_id: "verification-1",
      },
      {
        health: "error",
        id: "repository-2",
        lifecycle: "enabled",
        verification_id: "verification-2",
      },
    ],
  );
  assert.deepEqual(
    core.get(
      `SELECT error_code, id FROM forgejo_connection_verifications
       ORDER BY rowid DESC LIMIT 1`,
    ),
    {
      error_code: "forgejo_repository_selection_unavailable",
      id: "verification-5",
    },
  );
  ambiguousFailure = false;
  const beforeNewerHealthFailure = {
    generation: core.get(
      `SELECT value FROM quality_bar_metadata
       WHERE key = 'forgejo_poll_generation:connection-1'`,
    )?.value,
    verificationCount: core.get(
      "SELECT count(*) AS count FROM forgejo_connection_verifications",
    )?.count,
  };
  newerSiblingHealthAndFailure = true;
  await assert.rejects(
    repositories.setLifecycle("repository-1", { lifecycle: "enabled" }),
    { code: "forgejo_repository_enablement_conflict" },
  );
  assert.deepEqual(
    core.get(
      `SELECT health, health_error_code, health_error_message, verified_at
       FROM repositories WHERE id = 'repository-2'`,
    ),
    {
      health: "error",
      health_error_code: "forgejo_poll_response_invalid",
      health_error_message: "Newer polling failure",
      verified_at: 1_000,
    },
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM forgejo_connection_verifications")
      ?.count,
    beforeNewerHealthFailure.verificationCount,
  );
  assert.equal(
    Number(
      core.get(
        `SELECT value FROM quality_bar_metadata
         WHERE key = 'forgejo_poll_generation:connection-1'`,
      )?.value,
    ),
    Number(beforeNewerHealthFailure.generation) + 1,
  );
  newerSiblingHealthAndFailure = false;
  const before = {
    polling: core.all(
      `SELECT forge_repository_id, baseline_status, snapshot
       FROM forgejo_repository_polls ORDER BY forge_repository_id`,
    ),
    verificationCount: core.get(
      "SELECT count(*) AS count FROM forgejo_connection_verifications",
    )?.count,
  };

  retireSiblingDuringVerification = true;
  await assert.rejects(
    repositories.setLifecycle("repository-1", { lifecycle: "enabled" }),
    { code: "forgejo_repository_enablement_conflict" },
  );
  assert.deepEqual(
    core.all("SELECT id, lifecycle FROM repositories ORDER BY id"),
    [
      { id: "repository-1", lifecycle: "retired" },
      { id: "repository-2", lifecycle: "retired" },
    ],
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM forgejo_connection_verifications")
      ?.count,
    before.verificationCount,
  );
  assert.deepEqual(
    core.all(
      `SELECT forge_repository_id, baseline_status, snapshot
       FROM forgejo_repository_polls ORDER BY forge_repository_id`,
    ),
    before.polling,
  );
  retireSiblingDuringVerification = false;
  core.run(
    `UPDATE repositories
     SET lifecycle = 'enabled',
         lifecycle_revision = lifecycle_revision + 1
     WHERE id = 'repository-2'`,
  );
  core.run(
    `UPDATE forgejo_repository_polls
     SET baseline_status = 'pending', next_attempt_at = 0
     WHERE forge_repository_id = 22`,
  );
  await repositories.setLifecycle("repository-1", { lifecycle: "enabled" });
  assertForgejoSiblingRecovery(core);
  repositories.destroy();
  forgejo.destroy();
  core.close();
});
