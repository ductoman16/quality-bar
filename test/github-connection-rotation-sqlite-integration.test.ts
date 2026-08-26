import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createGitHubConnectionCredentialCipher } from "../src/github/github-connection-credential.ts";
import { GitHubConnectionError } from "../src/github/github-connection.ts";
import { openDurableCore } from "../src/durable/durable-core.ts";
import { createAvailableGitHubConnectionService } from "./storage-reserve-support.ts";

const verification = {
  capabilities: {
    aggregate_feedback: "verified",
    branch_access: "verified",
    commit_status: "verified",
    enumeration: "verified",
    inline_feedback: "verified",
    private_git_read: "verified",
    pull_request_access: "verified",
  },
  principal: { id: 91, login: "operator", type: "User" },
  repositories: [
    {
      api_url: "https://api.github.com/repos/operator/private",
      clone_url: "https://github.com/operator/private.git",
      full_name: "operator/private",
      html_url: "https://github.com/operator/private",
      id: 101,
      private: true,
    },
  ],
};

const app = {
  app_id: 47,
  app_slug: "quality-bar-personal",
  client_id: "Iv1.client",
  owner: { id: 91, login: "operator", type: "User" },
  pem: "initial-private-key",
};

function insertDependentRepositories(core: any) {
  core.run(
    `INSERT INTO repositories (
       id, normalized_url, lifecycle, created_at, verified_at
     ) VALUES (?, ?, 'enabled', ?, ?)`,
    "repository-1",
    "https://github.com/operator/private.git",
    1_000,
    1_000,
  );
  core.run(
    `INSERT INTO repositories (
       id, normalized_url, lifecycle, created_at, verified_at
     ) VALUES (?, ?, 'disabled', ?, ?)`,
    "repository-2",
    "https://github.com/operator/inactive.git",
    1_000,
    1_000,
  );
  core.run(
    `INSERT INTO github_repositories (
       repository_id, connection_id, forge_repository_id, name,
       api_url, web_url, verification_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    "repository-1",
    "connection-1",
    101,
    "operator/private",
    "https://api.github.com/repos/operator/private",
    "https://github.com/operator/private",
    "verification-1",
  );
  core.run(
    `INSERT INTO github_repositories (
       repository_id, connection_id, forge_repository_id, name,
       api_url, web_url, verification_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    "repository-2",
    "connection-1",
    202,
    "operator/inactive",
    "https://api.github.com/repos/operator/inactive",
    "https://github.com/operator/inactive",
    "verification-1",
  );
  core.run(
    `INSERT INTO github_repository_polls (
       connection_id, forge_repository_id, baseline_status,
       last_success_at, next_attempt_at, snapshot
     ) VALUES (?, ?, 'complete', ?, ?, ?)`,
    "connection-1",
    101,
    1_000,
    61_000,
    "[]",
  );
}

test("GitHub App rotation verifies active dependents before one encrypted swap", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-github-rotation-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  let rotationVerificationIds;
  const service = createAvailableGitHubConnectionService(core, {
    createId: (() => {
      const ids = ["connection-1", "verification-1", "verification-rotation"];
      return () => ids.shift();
    })(),
    externalOrigin: "https://quality-bar.example",
    masterKey: Buffer.alloc(32, 7),
    now: () => 2_000,
    verifier: {
      async exchangeManifest() {
        return app;
      },
      async listPullRequests() {
        return [];
      },
      async verifyInstallation(
        credential: any,
        installationId: number,
        repositoryIds: number[] | undefined,
      ) {
        assert.equal(installationId, 73);
        assert.ok(
          ["initial-private-key", "replacement-private-key"].includes(
            credential.pem,
          ),
        );
        rotationVerificationIds = repositoryIds;
        return verification;
      },
      async verifyRepositories() {
        throw new Error("repository selection is not exercised");
      },
    } as any,
  });
  const started = service.start();
  await service.completeManifest({ code: "code", state: started.state });
  await service.completeInstallation({
    installationId: "73",
    state: started.state,
  });
  insertDependentRepositories(core);
  core.run(
    `UPDATE repositories
        SET health = 'error', health_error_code = ?, health_error_message = ?
      WHERE id = ?`,
    "stale_provider_error",
    "The prior credential could not poll this Repository",
    "repository-1",
  );
  core.run(
    `UPDATE github_repository_polls
        SET baseline_status = 'error', last_success_at = NULL,
            error_code = ?, error_message = ?, snapshot = NULL
      WHERE connection_id = ? AND forge_repository_id = ?`,
    "stale_provider_error",
    "The prior credential could not poll this Repository",
    "connection-1",
    101,
  );
  const before = (
    core.get(
      "SELECT encrypted_credential FROM github_connection_credentials",
    ) as { encrypted_credential: string }
  ).encrypted_credential;
  const rotated = (await service.rotate({
    pem: "replacement-private-key",
  })) as any;
  assert.equal(rotated.health, "healthy");
  assert.deepEqual(rotationVerificationIds, [101]);
  assert.equal(rotated.verification_history.at(-1).trigger, "rotation");
  assert.equal(rotated.repository_count, 1);
  assert.deepEqual(
    core.get(
      `SELECT baseline_status, error_code, error_message
         FROM github_repository_polls
        WHERE connection_id = ? AND forge_repository_id = ?`,
      "connection-1",
      101,
    ),
    { baseline_status: "complete", error_code: null, error_message: null },
  );
  const after = (
    core.get(
      "SELECT encrypted_credential FROM github_connection_credentials",
    ) as { encrypted_credential: string }
  ).encrypted_credential;
  assert.notEqual(after, before);
  assert.doesNotMatch(after, /replacement-private-key/);
  const cipher = createGitHubConnectionCredentialCipher(Buffer.alloc(32, 7));
  assert.equal(
    cipher.decrypt({ appId: 47, id: "connection-1" }, after).pem,
    "replacement-private-key",
  );
  assert.equal(
    (
      core.get(
        `SELECT verification_id FROM github_repositories
       WHERE forge_repository_id = 101`,
      ) as { verification_id: string }
    ).verification_id,
    "verification-rotation",
  );
  assert.equal(
    (
      core.get(
        `SELECT verification_id FROM github_repositories
       WHERE forge_repository_id = 202`,
      ) as { verification_id: string }
    ).verification_id,
    "verification-1",
  );
  service.destroy();

  let failureAttempt = 0;
  let baselineFailure = false;
  const failed = createAvailableGitHubConnectionService(core, {
    createId: () => `verification-failure-${failureAttempt++}`,
    externalOrigin: "https://quality-bar.example",
    masterKey: Buffer.alloc(32, 7),
    now: () => 3_000,
    verifier: {
      async exchangeManifest() {
        throw new Error("manifest exchange is not exercised");
      },
      async listPullRequests() {
        if (baselineFailure) {
          throw new GitHubConnectionError(
            "github_repository_api_access_failed",
            "GitHub Repository API access failed during replacement baseline",
            {
              affectedRepositoryIds: [101, 101],
              repositoryEvidence: verification.repositories,
              repositoryId: 101,
            },
          );
        }
        return [];
      },
      async verifyInstallation() {
        if (failureAttempt === 1) {
          throw new GitHubConnectionError(
            "github_permissions_mismatch",
            "GitHub App permissions do not match the required profile",
          );
        }
        if (failureAttempt === 2) {
          throw new GitHubConnectionError(
            "github_repository_api_access_failed",
            "GitHub Repository API access failed",
            {
              affectedRepositoryIds: [101, 101],
              repositoryEvidence: verification.repositories,
              repositoryId: 101,
            },
          );
        }
        if (failureAttempt === 4) {
          return {
            ...verification,
            principal: { id: 91, login: "operator", type: "Organization" },
          };
        }
        return verification;
      },
      async verifyRepositories() {
        throw new Error("repository selection is not exercised");
      },
    },
  });
  await assert.rejects(
    () => failed.rotate({ pem: "rejected-private-key" }),
    (error) =>
      error instanceof GitHubConnectionError &&
      error.code === "github_permissions_mismatch",
  );
  assert.equal(
    (
      core.get(
        "SELECT encrypted_credential FROM github_connection_credentials",
      ) as { encrypted_credential: string }
    ).encrypted_credential,
    after,
  );
  assert.equal(
    (
      core.get(
        `SELECT trigger, outcome, error_code
         FROM github_connection_verifications
        ORDER BY rowid DESC LIMIT 1`,
      ) as { trigger: string; outcome: string; error_code: string }
    ).trigger,
    "rotation",
  );
  assert.equal(
    (
      core.get(
        `SELECT trigger, outcome, error_code
         FROM github_connection_verifications
        ORDER BY rowid DESC LIMIT 1`,
      ) as { trigger: string; outcome: string; error_code: string }
    ).error_code,
    "github_permissions_mismatch",
  );
  await assert.rejects(
    () => failed.rotate({ pem: "rejected-repository-private-key" }),
    (error) =>
      error instanceof GitHubConnectionError &&
      error.code === "github_repository_api_access_failed",
  );
  assert.deepEqual(
    JSON.parse(
      (
        core.get(
          `SELECT affected_repository_ids
             FROM github_connection_verifications
            ORDER BY rowid DESC LIMIT 1`,
        ) as { affected_repository_ids: string }
      ).affected_repository_ids,
    ),
    [101],
  );
  core.run(
    `UPDATE github_repository_polls
        SET error_code = ?, error_message = ?, rate_gate_until = ?,
            next_attempt_at = ?
      WHERE connection_id = ? AND forge_repository_id = ?`,
    "stale_provider_error",
    "The prior credential could not poll this Repository",
    50_000,
    50_000,
    "connection-1",
    101,
  );
  core.run(
    `INSERT INTO quality_bar_metadata (key, value) VALUES (?, ?)`,
    "github_poll_gate:connection-1",
    JSON.stringify({
      code: "stale_provider_error",
      forgeRepositoryId: 101,
      hasUnrepresentedFailureOwner: false,
      message: "The prior credential could not poll this Repository",
      nextAttemptAt: 50_000,
      rateGateUntil: 50_000,
    }),
  );
  const beforeBaselineFailure = core.get(
    `SELECT baseline_status, last_success_at, error_code, error_message,
            rate_gate_until, next_attempt_at, snapshot,
            repositories.health AS repository_health,
            github_connections.health AS connection_health
       FROM github_repository_polls
       JOIN github_repositories USING (connection_id, forge_repository_id)
       JOIN repositories ON repositories.id = github_repositories.repository_id
       JOIN github_connections ON github_connections.id = github_repository_polls.connection_id
      WHERE github_repository_polls.connection_id = ?
        AND github_repository_polls.forge_repository_id = ?`,
    "connection-1",
    101,
  );
  const beforeBaselineGate = core.get(
    "SELECT value FROM quality_bar_metadata WHERE key = ?",
    "github_poll_gate:connection-1",
  );
  baselineFailure = true;
  await assert.rejects(
    () => failed.rotate({ pem: "rejected-baseline-private-key" }),
    (error) =>
      error instanceof GitHubConnectionError &&
      error.code === "github_repository_api_access_failed",
  );
  assert.deepEqual(
    core.get(
      `SELECT baseline_status, last_success_at, error_code, error_message,
              rate_gate_until, next_attempt_at, snapshot,
              repositories.health AS repository_health,
              github_connections.health AS connection_health
         FROM github_repository_polls
         JOIN github_repositories USING (connection_id, forge_repository_id)
         JOIN repositories ON repositories.id = github_repositories.repository_id
         JOIN github_connections ON github_connections.id = github_repository_polls.connection_id
        WHERE github_repository_polls.connection_id = ?
          AND github_repository_polls.forge_repository_id = ?`,
      "connection-1",
      101,
    ),
    beforeBaselineFailure,
  );
  assert.deepEqual(
    core.get(
      "SELECT value FROM quality_bar_metadata WHERE key = ?",
      "github_poll_gate:connection-1",
    ),
    beforeBaselineGate,
  );
  assert.equal(
    (
      core.get(
        "SELECT encrypted_credential FROM github_connection_credentials",
      ) as { encrypted_credential: string }
    ).encrypted_credential,
    after,
  );
  await assert.rejects(
    () => failed.rotate({ pem: "rejected-principal-private-key" }),
    (error) =>
      error instanceof GitHubConnectionError &&
      error.code === "github_connection_rotation_verification_invalid",
  );
  failed.destroy();
  core.close();
});
