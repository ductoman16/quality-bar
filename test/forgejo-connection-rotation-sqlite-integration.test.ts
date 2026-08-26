import {
  availableStorageReserve,
  forgejoAutomaticEvaluationTestDependencies,
} from "./storage-reserve-support.ts";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable/durable-core.ts";
import { createForgejoConnectionService } from "../src/forgejo/forgejo-connection.ts";
import { createRepositoryService } from "../src/repository/repository.ts";
import {
  forgejoVerification,
  repositoryEvidence,
} from "./forgejo-polling-sqlite-integration-support.ts";

const repository = {
  api_url: "https://forgejo.example/api/v1/repos/operator/private",
  clone_url: "https://forgejo.example/operator/private.git",
  full_name: "operator/private",
  html_url: "https://forgejo.example/operator/private",
  id: 11,
  outcome: "success",
  permissions: { admin: true, pull: true, push: true },
  private: true,
};

test("SQLite preserves completed Forgejo evidence when replacement identity mismatches", async (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-forgejo-identity-rotation-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  let timestamp = 1_000;
  const registeredSecrets: string[] = [];
  const service = createForgejoConnectionService(core, {
    ...forgejoAutomaticEvaluationTestDependencies,
    registerSecret: (secret) => registeredSecrets.push(secret),
    storageReserve: availableStorageReserve,
    createId: (() => {
      const ids = [
        "connection-1",
        "verification-1",
        "repository-1",
        "verification-2",
      ];
      return () => ids.shift();
    })(),
    masterKey: Buffer.alloc(32, 7),
    now: () => timestamp,
    verifier: {
      async listPullRequests() {
        return [];
      },
      async verify({ token }) {
        assert.ok(registeredSecrets.includes(token));
        return {
          capabilities: { private_git_read: "verified" },
          principal: {
            id: token === "wrong-principal-pat" ? 8 : 7,
            login: "operator",
          },
          profile: "forgejo",
          reported_version: "16.0.4",
          repositories: [repository],
          scopes: ["read:repository", "write:issue", "write:repository"],
        };
      },
    },
  });
  await service.connect({
    base_url: "https://forgejo.example",
    repository_ids: [11],
    token: "original-pat",
  });

  timestamp = 2_000;
  await assert.rejects(() => service.rotate({ token: "wrong-principal-pat" }), {
    code: "forgejo_rotation_identity_mismatch",
  });
  assert.deepEqual(service.read()?.health_error, {
    code: "forgejo_rotation_identity_mismatch",
    message: "Replacement Forgejo PAT does not match the configured Connection",
  });
  assert.deepEqual(
    core.get(
      `SELECT profile, reported_version, principal, scopes, capabilities,
              repositories, error_code, error_message
       FROM forgejo_connection_verifications
       WHERE id = 'verification-2'`,
    ),
    {
      capabilities: JSON.stringify({ private_git_read: "verified" }),
      error_code: "forgejo_rotation_identity_mismatch",
      error_message:
        "Replacement Forgejo PAT does not match the configured Connection",
      principal: JSON.stringify({ id: 8, login: "operator" }),
      profile: "forgejo",
      reported_version: "16.0.4",
      repositories: JSON.stringify([repository]),
      scopes: JSON.stringify([
        "read:repository",
        "write:issue",
        "write:repository",
      ]),
    },
  );
  service.destroy();
  core.close();
});

test("a corrected Repository failure never strands its healthy Forgejo sibling", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-forgejo-sibling-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  const masterKey = Buffer.alloc(32, 28);
  const evidence = [
    repositoryEvidence(11, "one"),
    repositoryEvidence(22, "two"),
  ];
  let currentTime = 1_000;
  let permissionDenied = false;
  let attempted: number[] = [];
  const forgejo = createForgejoConnectionService(core, {
    ...forgejoAutomaticEvaluationTestDependencies,
    storageReserve: availableStorageReserve,
    createId: (() => {
      const ids = [
        "connection-1",
        "verification-1",
        "repository-1",
        "repository-2",
        "verification-2",
      ];
      return () => ids.shift();
    })(),
    masterKey,
    now: () => currentTime,
    verifier: {
      async listPullRequests(connection, candidate) {
        assert.equal(connection.token, "pat");
        if (currentTime > 1_000) {
          attempted.push(candidate.id);
        }
        if (permissionDenied && candidate.id === 11) {
          throw Object.assign(new Error("Forgejo Repository is forbidden"), {
            code: "forgejo_repository_permission_denied",
            repositoryId: 11,
          });
        }
        return [];
      },
      async verify({ repositoryIds }) {
        return forgejoVerification(
          evidence.filter(({ id }) => repositoryIds.includes(id)),
        );
      },
    },
  });
  await forgejo.connect({
    base_url: "https://forgejo.example",
    repository_ids: [11, 22],
    token: "pat",
  });

  currentTime = 61_000;
  permissionDenied = true;
  await forgejo.runPolling();
  assert.deepEqual(attempted, [11, 22]);
  const repositories = createRepositoryService(core, {
    masterKey,
    now: () => currentTime,
    verifyForgeRepository: (forgeRepositoryId) =>
      forgejo.prepareRepositoryEnablement(forgeRepositoryId),
  });
  await repositories.setLifecycle("repository-1", { lifecycle: "disabled" });
  permissionDenied = false;
  await repositories.setLifecycle("repository-1", { lifecycle: "enabled" });

  currentTime = 121_000;
  attempted = [];
  await forgejo.runPolling();
  assert.deepEqual(attempted, [11, 22]);
  assert.deepEqual(
    core
      .all(
        `SELECT baseline_status, error_code, next_attempt_at
           FROM forgejo_repository_polls ORDER BY forge_repository_id`,
      )
      .map((row) => row && { ...row }),
    [
      {
        baseline_status: "complete",
        error_code: null,
        next_attempt_at: 181_000,
      },
      {
        baseline_status: "complete",
        error_code: null,
        next_attempt_at: 181_000,
      },
    ],
  );
  repositories.destroy();
  forgejo.destroy();
  core.close();
});

test("SQLite rejects a stale failed rotation after another replacement succeeds", async (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-forgejo-concurrent-rotation-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  let timestamp = 1_000;
  let pollCredentialFails = false;
  let releaseFailure = () => {};
  let markFailureStarted = () => {};
  const failureStarted = new Promise((resolve) => {
    markFailureStarted = () => resolve(undefined);
  });
  const failureReleased = new Promise((resolve) => {
    releaseFailure = () => resolve(undefined);
  });
  const service = createForgejoConnectionService(core, {
    ...forgejoAutomaticEvaluationTestDependencies,
    storageReserve: availableStorageReserve,
    createId: (() => {
      const ids = [
        "connection-1",
        "verification-1",
        "repository-1",
        "verification-2",
        "verification-3",
      ];
      return () => ids.shift();
    })(),
    masterKey: Buffer.alloc(32, 8),
    now: () => timestamp,
    verifier: {
      async listPullRequests(connection) {
        if (pollCredentialFails && connection.token === "original-pat") {
          throw Object.assign(new Error("Forgejo credential is invalid"), {
            code: "forgejo_connection_credential_invalid",
            repositoryId: 11,
          });
        }
        return [];
      },
      async verify({ token }) {
        if (token === "stale-failing-pat") {
          markFailureStarted();
          await failureReleased;
          throw Object.assign(new Error("Forgejo provider unavailable"), {
            code: "forgejo_provider_unavailable",
          });
        }
        return {
          capabilities: { private_git_read: "verified" },
          principal: { id: 7, login: "operator" },
          profile: "forgejo",
          reported_version: "16.0.4",
          repositories: [repository],
          scopes: ["read:repository", "write:issue", "write:repository"],
        };
      },
    },
  });
  await service.connect({
    base_url: "https://forgejo.example",
    repository_ids: [11],
    token: "original-pat",
  });
  pollCredentialFails = true;
  timestamp = 61_000;
  await service.runPolling();
  assert.equal(service.read()?.health, "error");

  const stale = service.rotate({ token: "stale-failing-pat" });
  await failureStarted;
  timestamp = 62_000;
  const current = (await service.rotate({
    token: "current-replacement-pat",
  })) as NonNullable<Awaited<ReturnType<typeof service.read>>>;
  releaseFailure();
  await assert.rejects(stale, {
    code: "forgejo_connection_rotation_conflict",
  });
  assert.equal(current?.health, "healthy");
  assert.deepEqual(service.read()?.health_error, null);
  assert.equal(
    core.get(
      "SELECT count(*) AS count FROM quality_bar_metadata WHERE key LIKE 'forgejo_poll_gate:%'",
    )?.count,
    0,
  );
  assert.deepEqual(
    core.get(
      `SELECT baseline_status, error_code, next_attempt_at
         FROM forgejo_repository_polls`,
    ),
    {
      baseline_status: "complete",
      error_code: null,
      next_attempt_at: 122_000,
    },
  );
  assert.deepEqual(
    core.all(
      "SELECT id, error_code FROM forgejo_connection_verifications ORDER BY rowid",
    ),
    [
      { error_code: null, id: "verification-1" },
      { error_code: null, id: "verification-3" },
    ],
  );
  service.destroy();
  core.close();
});
