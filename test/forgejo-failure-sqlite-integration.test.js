import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createForgejoConnectionService } from "../src/forgejo-connection.js";
import { openDurableCore } from "../src/durable-core.js";
import {
  forgejoVerification,
  repositoryEvidence,
} from "./forgejo-polling-sqlite-integration-support.js";
import {
  availableStorageReserve,
  forgejoAutomaticEvaluationTestDependencies,
} from "./storage-reserve-support.js";

const repository = repositoryEvidence(11, "one");

test("SQLite records transient Forgejo rotation failure without inventing unhealthy Connection state", async (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-forgejo-transient-rotation-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  let timestamp = 1_000;
  let pollingFailure = false;
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
        "verification-4",
      ];
      return () => ids.shift();
    })(),
    masterKey: Buffer.alloc(32, 29),
    now: () => timestamp,
    verifier: {
      async listPullRequests() {
        if (pollingFailure) {
          throw Object.assign(
            new Error("Forgejo polling response is invalid"),
            {
              code: "forgejo_poll_response_invalid",
            },
          );
        }
        return [];
      },
      async verify({ token }) {
        if (token === "replacement-pat") {
          throw Object.assign(
            new Error("Forgejo verification is unavailable"),
            { code: "forgejo_api_unavailable" },
          );
        }
        if (token === "bad-auth-pat") {
          throw Object.assign(new Error("Forgejo PAT is invalid"), {
            code: "forgejo_connection_credential_invalid",
          });
        }
        return forgejoVerification([repository]);
      },
    },
  });
  await service.connect({
    base_url: "https://forgejo.example",
    repository_ids: [11],
    token: "original-pat",
  });

  timestamp = 2_000;
  await assert.rejects(() => service.rotate({ token: "replacement-pat" }), {
    code: "forgejo_api_unavailable",
  });
  assert.deepEqual(core.get("SELECT health FROM forgejo_connections"), {
    health: "healthy",
  });
  const connection = service.read();
  assert.equal(connection?.health_error, null);
  assert.deepEqual(connection?.verification_history.at(-1)?.error, {
    code: "forgejo_api_unavailable",
    message: "Forgejo verification is unavailable",
  });

  timestamp = 3_000;
  await assert.rejects(() => service.rotate({ token: "bad-auth-pat" }), {
    code: "forgejo_connection_credential_invalid",
  });
  timestamp = 4_000;
  await service.rotate({ token: "recovered-pat" });
  pollingFailure = true;
  timestamp = 65_000;
  await service.runPolling();
  assert.deepEqual(service.read()?.health_error, {
    code: "forgejo_poll_response_invalid",
    message: "Forgejo polling response is invalid",
  });
  service.destroy();
  core.close();
});

test("SQLite scopes replacement Repository access loss to its exact owner", async (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-forgejo-repository-rotation-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  const evidence = [repository, repositoryEvidence(22, "two")];
  const repositoryChecks = [
    {
      error: {
        code: "forgejo_repository_permission_denied",
        message: "Forgejo Repository access was removed",
      },
      forge_repository_id: 11,
      outcome: "error",
      permissions: evidence[0].permissions,
    },
    {
      forge_repository_id: 22,
      outcome: "not_completed",
      permissions: evidence[1].permissions,
    },
  ];
  const service = createForgejoConnectionService(core, {
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
    masterKey: Buffer.alloc(32, 30),
    now: () => 2_000,
    verifier: {
      async listPullRequests() {
        return [];
      },
      async verify({ token }) {
        if (token === "replacement-pat") {
          throw Object.assign(
            new Error("Forgejo Repository access was removed"),
            {
              code: "forgejo_repository_permission_denied",
              repositoryChecks,
              repositoryId: 11,
            },
          );
        }
        return forgejoVerification(evidence);
      },
    },
  });
  await service.connect({
    base_url: "https://forgejo.example",
    repository_ids: [11, 22],
    token: "original-pat",
  });
  core.run(
    `INSERT INTO forgejo_connection_verifications (
       id, connection_id, trigger, profile, reported_version, principal,
       scopes, capabilities, repositories, error_code, error_message, verified_at
     )
     SELECT 'verification-existing-outage', connection_id, 'manual_test',
            profile, reported_version, principal, scopes, capabilities,
            repositories, 'forgejo_connection_credential_invalid',
            'existing Connection outage', 1500
     FROM forgejo_connection_verifications WHERE id = 'verification-1'`,
  );
  core.run(
    "UPDATE forgejo_connections SET health = 'error', verified_at = 1500",
  );

  await assert.rejects(() => service.rotate({ token: "replacement-pat" }), {
    code: "forgejo_repository_permission_denied",
  });
  assert.equal(service.read()?.health, "error");
  assert.deepEqual(service.read()?.health_error, {
    code: "forgejo_connection_credential_invalid",
    message: "existing Connection outage",
  });
  assert.deepEqual(
    core.all("SELECT id, health FROM repositories ORDER BY id"),
    [
      { health: "error", id: "repository-1" },
      { health: "healthy", id: "repository-2" },
    ],
  );
  assert.deepEqual(
    JSON.parse(
      /** @type {string} */ (
        core.get(
          "SELECT repositories FROM forgejo_connection_verifications WHERE id = 'verification-2'",
        )?.repositories
      ),
    ),
    repositoryChecks,
  );
  service.destroy();
  core.close();
});

test("SQLite fails rotation when the failed Repository mapping disappears", async (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-forgejo-repository-rotation-conflict-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  const service = createForgejoConnectionService(core, {
    ...forgejoAutomaticEvaluationTestDependencies,
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
    masterKey: Buffer.alloc(32, 31),
    now: () => 2_000,
    verifier: {
      async listPullRequests() {
        return [];
      },
      async verify({ token }) {
        if (token === "replacement-pat") {
          core.run(
            "DELETE FROM forgejo_repositories WHERE connection_id = 'connection-1'",
          );
          throw Object.assign(
            new Error("Forgejo Repository access was removed"),
            {
              code: "forgejo_repository_permission_denied",
              repositoryChecks: [
                {
                  error: {
                    code: "forgejo_repository_permission_denied",
                    message: "Forgejo Repository access was removed",
                  },
                  forge_repository_id: 11,
                  outcome: "error",
                  permissions: repository.permissions,
                },
              ],
              repositoryId: 11,
            },
          );
        }
        return forgejoVerification([repository]);
      },
    },
  });
  await service.connect({
    base_url: "https://forgejo.example",
    repository_ids: [11],
    token: "original-pat",
  });

  await assert.rejects(() => service.rotate({ token: "replacement-pat" }), {
    code: "forgejo_connection_rotation_conflict",
  });
  assert.equal(
    core.get("SELECT count(*) AS count FROM forgejo_connection_verifications")
      ?.count,
    1,
  );
  service.destroy();
  core.close();
});

test("SQLite gates every Repository proven missing during one rotation", async (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-forgejo-multiple-repository-failure-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  const repositories = [repository, repositoryEvidence(22, "two")];
  const service = createForgejoConnectionService(core, {
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
    masterKey: Buffer.alloc(32, 32),
    now: () => 2_000,
    verifier: {
      async listPullRequests() {
        return [];
      },
      async verify({ token }) {
        if (token === "replacement-pat") {
          const message =
            "Selected Forgejo Repository is not accessible to the Connection";
          throw Object.assign(new Error(message), {
            code: "forgejo_repository_selection_unavailable",
            repositoryChecks: repositories.map((candidate) => ({
              error: {
                code: "forgejo_repository_selection_unavailable",
                message,
              },
              forge_repository_id: candidate.id,
              outcome: "error",
              permissions: candidate.permissions,
            })),
            repositoryIds: [11, 22],
          });
        }
        return forgejoVerification(repositories);
      },
    },
  });
  await service.connect({
    base_url: "https://forgejo.example",
    repository_ids: [11, 22],
    token: "original-pat",
  });

  await assert.rejects(() => service.rotate({ token: "replacement-pat" }), {
    code: "forgejo_repository_selection_unavailable",
  });
  assert.deepEqual(
    core.all("SELECT id, health FROM repositories ORDER BY id"),
    [
      { health: "error", id: "repository-1" },
      { health: "error", id: "repository-2" },
    ],
  );
  service.destroy();
  core.close();
});
