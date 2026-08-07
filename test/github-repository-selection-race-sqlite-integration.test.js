import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { GitHubConnectionError } from "../src/github-connection-error.js";
import { openDurableCore } from "../src/durable-core.js";
import {
  availableRepositories,
  capabilities,
} from "./github-repository-selection-fixtures.js";
import { createAvailableGitHubConnectionService } from "./storage-reserve-support.js";

test("ordinary GitHub selection rejects a Repository deleted while verification is in flight", async (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-github-selection-race-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  let deleteSiblingDuringVerification = false;
  let disableTargetAndFailVerification = false;
  let newerVerificationAndFail = false;
  let failPollingBaseline = false;
  let advancePollingDuringBaseline = false;
  const service = createAvailableGitHubConnectionService(core, {
    createId: (() => {
      const ids = [
        "connection-1",
        "verification-1",
        "repository-alpha",
        "repository-beta",
      ];
      return () => ids.shift();
    })(),
    externalOrigin: "https://quality-bar.example",
    masterKey: Buffer.alloc(32, 25),
    now: () => 1_000,
    randomBytes: () => Buffer.alloc(32, 5),
    verifier: {
      async exchangeManifest() {
        return {
          app_id: 47,
          app_slug: "quality-bar-personal",
          client_id: "Iv1.client",
          owner: { id: 91, login: "operator", type: "User" },
          pem: "private-key-value",
        };
      },
      async verifyInstallation() {
        return {
          capabilities,
          principal: { id: 91, login: "operator", type: "User" },
          repositories: availableRepositories,
        };
      },
      async listPullRequests() {
        if (failPollingBaseline) {
          throw new GitHubConnectionError(
            "github_repository_api_access_failed",
            "GitHub polling baseline failed",
            { repositoryId: 101 },
          );
        }
        if (advancePollingDuringBaseline) {
          core.run(
            `UPDATE github_repository_polls
             SET baseline_status = 'complete',
                 last_success_at = 4000,
                 error_code = NULL,
                 error_message = NULL,
                 rate_gate_until = NULL,
                 next_attempt_at = 64000,
                 snapshot = '[{"number":4000}]'
             WHERE connection_id = 'connection-1'
               AND forge_repository_id = 101`,
          );
          core.run(
            `INSERT INTO quality_bar_metadata (key, value)
             VALUES ('github_poll_generation:connection-1', '1')
             ON CONFLICT (key) DO UPDATE
             SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)`,
          );
        }
        return [];
      },
      async verifyRepositories(...parameters) {
        const repositoryIds = parameters[2];
        if (newerVerificationAndFail) {
          core.run(
            `UPDATE github_connections
             SET health = 'error',
                 health_error_code = 'github_installation_access_failed',
                 health_error_message = 'Newer Connection verification',
                 repository_count = 1,
                 verified_at = 1000
             WHERE id = 'connection-1'`,
          );
          core.run(
            `UPDATE repositories
             SET health = 'error',
                 health_error_code = 'github_repository_permission_denied',
                 health_error_message = 'Newer Repository verification',
                 verified_at = 1000
             WHERE id = 'repository-alpha'`,
          );
          core.run(
            `UPDATE github_repositories
             SET verification_id = 'verification-1'
             WHERE repository_id = 'repository-alpha'`,
          );
          throw new GitHubConnectionError(
            "github_repository_git_read_failed",
            "Older GitHub Repository failure",
            {
              affectedRepositoryIds: [101],
              repositoryId: 101,
            },
          );
        }
        if (disableTargetAndFailVerification) {
          core.run(
            `UPDATE repositories
             SET lifecycle = 'disabled',
                 lifecycle_revision = lifecycle_revision + 1
             WHERE id = 'repository-alpha'`,
          );
          throw new GitHubConnectionError(
            "github_repository_git_read_failed",
            "GitHub Repository Git read failed",
            {
              affectedRepositoryIds: [101],
              repositoryId: 101,
            },
          );
        }
        if (deleteSiblingDuringVerification) {
          core.run(
            `DELETE FROM github_repository_polls
             WHERE connection_id = 'connection-1'
               AND forge_repository_id = 202`,
          );
          core.run(
            `DELETE FROM github_repositories
             WHERE connection_id = 'connection-1'
               AND forge_repository_id = 202`,
          );
          core.run("DELETE FROM repositories WHERE id = 'repository-beta'");
        }
        return {
          affectedRepositoryIds: repositoryIds,
          capabilities,
          permissions: service.read()?.permissions,
          principal: { id: 91, login: "operator", type: "User" },
          repositories: availableRepositories.filter(({ id }) =>
            repositoryIds.includes(id),
          ),
          repositoryEvidence: deleteSiblingDuringVerification
            ? availableRepositories.filter(({ id }) => id !== 202)
            : availableRepositories,
        };
      },
    },
  });
  const started = service.start();
  await service.completeManifest({ code: "code", state: started.state });
  await service.completeInstallation({
    installationId: "73",
    state: started.state,
  });
  await service.selectRepositories({
    repository_ids: [101, 202],
    request_id: "00000000-0000-4000-8000-000000000001",
  });
  const before = {
    verificationCount: core.get(
      "SELECT count(*) AS count FROM github_connection_verifications",
    )?.count,
    verificationId: core.get(
      `SELECT verification_id FROM github_repositories
       WHERE repository_id = 'repository-alpha'`,
    )?.verification_id,
  };

  disableTargetAndFailVerification = true;
  await assert.rejects(
    service.selectRepositories({
      repository_ids: [101],
      request_id: "00000000-0000-4000-8000-000000000002",
    }),
    (error) =>
      error instanceof GitHubConnectionError &&
      error.code === "github_repository_enablement_conflict",
  );
  assert.deepEqual(
    core.get(
      `SELECT lifecycle, health, verification_id
       FROM repositories
       JOIN github_repositories
         ON github_repositories.repository_id = repositories.id
       WHERE repositories.id = 'repository-alpha'`,
    ),
    {
      health: "healthy",
      lifecycle: "disabled",
      verification_id: before.verificationId,
    },
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM github_connection_verifications")
      ?.count,
    before.verificationCount,
  );

  disableTargetAndFailVerification = false;
  deleteSiblingDuringVerification = true;
  await assert.rejects(
    service.selectRepositories({
      repository_ids: [101],
      request_id: "00000000-0000-4000-8000-000000000003",
    }),
    (error) =>
      error instanceof GitHubConnectionError &&
      error.code === "github_repository_identity_conflict",
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM github_connection_verifications")
      ?.count,
    before.verificationCount,
  );
  assert.equal(
    core.get(
      `SELECT verification_id FROM github_repositories
       WHERE repository_id = 'repository-alpha'`,
    )?.verification_id,
    before.verificationId,
  );
  assert.equal(
    core.get(
      "SELECT count(*) AS count FROM repositories WHERE id = ?",
      "repository-beta",
    )?.count,
    0,
  );
  deleteSiblingDuringVerification = false;
  newerVerificationAndFail = true;
  await assert.rejects(
    service.selectRepositories({
      repository_ids: [101],
      request_id: "00000000-0000-4000-8000-000000000004",
    }),
    (error) =>
      error instanceof GitHubConnectionError &&
      error.code === "github_repository_enablement_conflict",
  );
  assert.deepEqual(
    core.get(
      `SELECT repositories.health, repositories.health_error_code,
              repositories.health_error_message, repositories.verified_at,
              github_repositories.verification_id
       FROM repositories
       JOIN github_repositories
         ON github_repositories.repository_id = repositories.id
       WHERE repositories.id = 'repository-alpha'`,
    ),
    {
      health: "error",
      health_error_code: "github_repository_permission_denied",
      health_error_message: "Newer Repository verification",
      verification_id: "verification-1",
      verified_at: 1_000,
    },
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM github_connection_verifications")
      ?.count,
    before.verificationCount,
  );
  newerVerificationAndFail = false;

  failPollingBaseline = true;
  const beforeBaselineFailureCount = core.get(
    "SELECT count(*) AS count FROM github_connection_verifications",
  )?.count;
  await assert.rejects(
    service.selectRepositories({
      repository_ids: [101],
      request_id: "00000000-0000-4000-8000-000000000005",
    }),
    (error) =>
      error instanceof GitHubConnectionError &&
      error.code === "github_repository_api_access_failed",
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM github_connection_verifications")
      ?.count,
    Number(beforeBaselineFailureCount) + 1,
  );
  assert.deepEqual(
    core.get(
      `SELECT repositories.health, repositories.health_error_code,
              repositories.health_error_message,
              github_repositories.verification_id,
              github_repository_polls.baseline_status,
              github_repository_polls.error_code,
              github_repository_polls.error_message
       FROM repositories
       JOIN github_repositories
         ON github_repositories.repository_id = repositories.id
       JOIN github_repository_polls
         ON github_repository_polls.connection_id =
              github_repositories.connection_id
        AND github_repository_polls.forge_repository_id =
              github_repositories.forge_repository_id
       WHERE repositories.id = 'repository-alpha'`,
    ),
    {
      baseline_status: "error",
      error_code: "github_repository_api_access_failed",
      error_message: "GitHub polling baseline failed",
      health: "error",
      health_error_code: "github_repository_api_access_failed",
      health_error_message: "GitHub polling baseline failed",
      verification_id: "00000000-0000-4000-8000-000000000005",
    },
  );
  failPollingBaseline = false;

  const beforeStaleBaselineCount = core.get(
    "SELECT count(*) AS count FROM github_connection_verifications",
  )?.count;
  advancePollingDuringBaseline = true;
  await assert.rejects(
    service.selectRepositories({
      repository_ids: [101],
      request_id: "00000000-0000-4000-8000-000000000006",
    }),
    (error) =>
      error instanceof GitHubConnectionError &&
      error.code === "github_repository_enablement_conflict",
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM github_connection_verifications")
      ?.count,
    beforeStaleBaselineCount,
  );
  assert.deepEqual(
    core.get(
      `SELECT baseline_status, last_success_at, next_attempt_at, snapshot
       FROM github_repository_polls
       WHERE connection_id = 'connection-1' AND forge_repository_id = 101`,
    ),
    {
      baseline_status: "complete",
      last_success_at: 4_000,
      next_attempt_at: 64_000,
      snapshot: '[{"number":4000}]',
    },
  );
  advancePollingDuringBaseline = false;
  service.destroy();
  core.close();
});
