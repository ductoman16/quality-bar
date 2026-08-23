import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable/durable-core.js";
import { createForgejoConnectionService } from "../src/forgejo/forgejo-connection.js";
import { prepareForgejoRepositoryEnablement } from "../src/repository/repository-provider-verification.js";
import { createRepositoryService } from "../src/repository/repository.js";
import {
  enabledRepositoryPoll,
  forgejoVerification,
  pullRequest,
  repositoryEvidence,
} from "./forgejo-polling-sqlite-integration-support.js";
import {
  availableStorageReserve,
  forgejoAutomaticEvaluationTestDependencies,
} from "./storage-reserve-support.js";

test("Forgejo Repository re-enablement commits exact failure health or one fresh baseline with lifecycle", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-forgejo-enable-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  const masterKey = Buffer.alloc(32, 22);
  let evidence = repositoryEvidence(11, "private");
  let observed = pullRequest(1);
  let failure = false;
  let staleFailure = false;
  let staleSuccess = false;
  /** @type {Error & {code: string} | null} */
  let verificationFailure = null;
  const forgejo = createForgejoConnectionService(core, {
    ...forgejoAutomaticEvaluationTestDependencies,
    createId: (() => {
      const ids = [
        "connection-1",
        "verification-1",
        "repository-1",
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
        if (failure) {
          if (staleFailure) {
            core.run(
              "UPDATE repositories SET lifecycle = 'disabled' WHERE id = 'repository-1'",
            );
          }
          throw Object.assign(new Error("Forgejo Repository is forbidden"), {
            code: "forgejo_repository_permission_denied",
            repositoryId: 11,
          });
        }
        return [observed];
      },
      async verify({ repositoryIds }) {
        if (verificationFailure) {
          throw verificationFailure;
        }
        if (staleSuccess) {
          core.run(
            `UPDATE repositories
             SET lifecycle_revision = lifecycle_revision + 2
             WHERE id = 'repository-1'`,
          );
        }
        return forgejoVerification(repositoryIds ? [evidence] : [evidence]);
      },
    },
  });
  await forgejo.connect({
    base_url: "https://forgejo.example",
    repository_ids: [11],
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
  observed = pullRequest(2);
  failure = true;
  await assert.rejects(
    () => repositories.setLifecycle("repository-1", { lifecycle: "enabled" }),
    /Forgejo Repository is forbidden/,
  );
  assert.deepEqual(
    enabledRepositoryPoll(
      core,
      `repositories.lifecycle, repositories.health,
       repositories.health_error_code, repositories.health_error_message,
       forgejo_repository_polls.snapshot`,
    ),
    {
      health: "error",
      health_error_code: "forgejo_repository_permission_denied",
      health_error_message: "Forgejo Repository is forbidden",
      lifecycle: "retired",
      snapshot: JSON.stringify([pullRequest(1)]),
    },
  );
  assert.deepEqual(
    core.get(
      `SELECT forgejo_connections.health,
              forgejo_repositories.verification_id
       FROM forgejo_connections
       JOIN forgejo_repositories
         ON forgejo_repositories.connection_id = forgejo_connections.id`,
    ),
    { health: "healthy", verification_id: "verification-2" },
  );
  assert.equal(forgejo.read()?.health, "healthy");
  assert.equal(
    forgejo.read()?.verification_history.at(-1)?.error?.code,
    "forgejo_repository_permission_denied",
  );

  failure = false;
  await repositories.setLifecycle("repository-1", { lifecycle: "enabled" });
  assert.deepEqual(
    enabledRepositoryPoll(
      core,
      `repositories.lifecycle, forgejo_repository_polls.last_success_at,
       forgejo_repository_polls.snapshot`,
    ),
    {
      last_success_at: 1_000,
      lifecycle: "enabled",
      snapshot: JSON.stringify([pullRequest(2)]),
    },
  );
  assert.deepEqual(
    core.get(
      `SELECT forgejo_connections.health,
              forgejo_repositories.verification_id
       FROM forgejo_connections
       JOIN forgejo_repositories
         ON forgejo_repositories.connection_id = forgejo_connections.id`,
    ),
    { health: "healthy", verification_id: "verification-3" },
  );
  assert.deepEqual(
    core
      .all(
        `SELECT id, trigger, error_code
         FROM forgejo_connection_verifications ORDER BY rowid`,
      )
      .map((row) => row),
    [
      { error_code: null, id: "verification-1", trigger: "onboarding" },
      {
        error_code: "forgejo_repository_permission_denied",
        id: "verification-2",
        trigger: "enablement",
      },
      { error_code: null, id: "verification-3", trigger: "enablement" },
    ],
  );

  await repositories.setLifecycle("repository-1", { lifecycle: "retired" });
  failure = true;
  staleFailure = true;
  const beforeStaleFailure = core.get(
    `SELECT forgejo_repositories.verification_id,
            forgejo_repository_polls.snapshot,
            quality_bar_metadata.value AS generation
     FROM forgejo_repositories
     JOIN forgejo_repository_polls
       ON forgejo_repository_polls.connection_id =
            forgejo_repositories.connection_id
      AND forgejo_repository_polls.forge_repository_id =
            forgejo_repositories.forge_repository_id
     JOIN quality_bar_metadata
       ON quality_bar_metadata.key =
            'forgejo_poll_generation:' || forgejo_repositories.connection_id`,
  );
  await assert.rejects(
    () => repositories.setLifecycle("repository-1", { lifecycle: "enabled" }),
    { code: "forgejo_repository_enablement_conflict" },
  );
  assert.equal(
    core.get("SELECT lifecycle FROM repositories WHERE id = 'repository-1'")
      ?.lifecycle,
    "disabled",
  );
  assert.deepEqual(
    core.get(
      `SELECT forgejo_repositories.verification_id,
              forgejo_repository_polls.snapshot,
              quality_bar_metadata.value AS generation
       FROM forgejo_repositories
       JOIN forgejo_repository_polls
         ON forgejo_repository_polls.connection_id =
              forgejo_repositories.connection_id
        AND forgejo_repository_polls.forge_repository_id =
              forgejo_repositories.forge_repository_id
       JOIN quality_bar_metadata
         ON quality_bar_metadata.key =
              'forgejo_poll_generation:' || forgejo_repositories.connection_id`,
    ),
    beforeStaleFailure,
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM forgejo_connection_verifications")
      ?.count,
    3,
  );

  failure = false;
  staleFailure = false;
  verificationFailure = Object.assign(
    new Error("Forgejo Connection requires stable v16.x"),
    { code: "forgejo_version_unsupported" },
  );
  await assert.rejects(
    () => repositories.setLifecycle("repository-1", { lifecycle: "enabled" }),
    { code: "forgejo_version_unsupported" },
  );
  assert.deepEqual(
    core.get(
      `SELECT forgejo_connections.health,
              forgejo_repositories.verification_id,
              repositories.health AS repository_health,
              repositories.lifecycle
       FROM forgejo_connections
       JOIN forgejo_repositories
         ON forgejo_repositories.connection_id = forgejo_connections.id
       JOIN repositories
         ON repositories.id = forgejo_repositories.repository_id`,
    ),
    {
      health: "error",
      lifecycle: "disabled",
      repository_health: "healthy",
      verification_id: "verification-3",
    },
  );
  assert.deepEqual(
    core.get(
      `SELECT error_code, id, trigger
       FROM forgejo_connection_verifications ORDER BY rowid DESC LIMIT 1`,
    ),
    {
      error_code: "forgejo_version_unsupported",
      id: "verification-5",
      trigger: "enablement",
    },
  );
  verificationFailure = null;
  core.run(
    `INSERT INTO repositories
       (id, normalized_url, created_at, verified_at)
     VALUES ('conflicting-repository', 'https://example.com/conflict.git', 1, 1)`,
  );
  evidence = {
    ...evidence,
    clone_url: "https://example.com/conflict.git",
  };
  await assert.rejects(
    () => repositories.setLifecycle("repository-1", { lifecycle: "enabled" }),
    { code: "forgejo_repository_identity_conflict" },
  );
  assert.equal(
    core.get("SELECT lifecycle FROM repositories WHERE id = 'repository-1'")
      ?.lifecycle,
    "disabled",
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM forgejo_connection_verifications")
      ?.count,
    4,
  );
  core.run("DELETE FROM repositories WHERE id = 'conflicting-repository'");
  evidence = repositoryEvidence(11, "private");
  staleSuccess = true;
  await assert.rejects(
    () => repositories.setLifecycle("repository-1", { lifecycle: "enabled" }),
    { code: "forgejo_repository_enablement_conflict" },
  );
  assert.equal(
    core.get("SELECT lifecycle FROM repositories WHERE id = 'repository-1'")
      ?.lifecycle,
    "disabled",
  );
  staleSuccess = false;
  await repositories.setLifecycle("repository-1", { lifecycle: "enabled" });
  assert.deepEqual(
    core.get(
      `SELECT forgejo_connections.health,
              forgejo_repositories.verification_id,
              repositories.lifecycle
       FROM forgejo_connections
       JOIN forgejo_repositories
         ON forgejo_repositories.connection_id = forgejo_connections.id
       JOIN repositories
         ON repositories.id = forgejo_repositories.repository_id`,
    ),
    {
      health: "healthy",
      lifecycle: "enabled",
      verification_id: "verification-8",
    },
  );
  assert.deepEqual(
    core.get(
      `SELECT error_code, id, trigger
       FROM forgejo_connection_verifications ORDER BY rowid DESC LIMIT 1`,
    ),
    { error_code: null, id: "verification-8", trigger: "enablement" },
  );
  repositories.destroy();
  forgejo.destroy();
  core.close();
});
