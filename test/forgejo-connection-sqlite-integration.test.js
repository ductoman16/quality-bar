import {
  availableStorageReserve,
  forgejoAutomaticEvaluationTestDependencies,
} from "./storage-reserve-support.js";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createForgejoConnectionService } from "../src/forgejo-connection.js";
import { createForgejoConnectionCredentialCipher } from "../src/forgejo-connection-credential.js";
import { openDurableCore } from "../src/durable-core.js";

const privateRepository = {
  api_url: "https://forgejo.example/api/v1/repos/operator/private",
  clone_url: "https://forgejo.example/operator/private.git",
  full_name: "operator/private",
  html_url: "https://forgejo.example/operator/private",
  id: 11,
  outcome: "success",
  permissions: { admin: true, pull: true, push: true },
  private: true,
};

test("SQLite atomically stores the selected Forgejo v16 Repositories and a secret-free verification", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-forgejo-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  assert.equal(core.facts.schemaVersion, 50);
  const service = createForgejoConnectionService(core, {
    ...forgejoAutomaticEvaluationTestDependencies,
    storageReserve: availableStorageReserve,
    createId: (() => {
      const ids = ["connection-1", "verification-1", "repository-1"];
      return () => ids.shift();
    })(),
    masterKey: Buffer.alloc(32, 1),
    now: () => 1_000,
    verifier: {
      async listPullRequests() {
        return [];
      },
      async verify(input) {
        assert.equal(input.baseUrl, "https://forgejo.example");
        return {
          capabilities: { private_git_read: "verified" },
          principal: { id: 7, login: "operator" },
          profile: "forgejo-v16",
          reported_version: "16.0.4",
          repositories: [privateRepository],
          scopes: ["read:repository", "write:issue", "write:repository"],
        };
      },
    },
  });
  const connection = await service.connect({
    base_url: "https://FORGEJO.EXAMPLE:443/",
    repository_ids: [11],
    token: "operator-created-pat",
  });
  assert.deepEqual(service.acquireRepositoryGitCredential("connection-1"), {
    token: "operator-created-pat",
    username: "oauth2",
  });
  const { verification_history: verificationHistory, ...projection } =
    /** @type {any} */ (connection);
  assert.equal(verificationHistory.length, 1);
  assert.equal(verificationHistory[0].trigger, "onboarding");
  assert.equal(verificationHistory[0].outcome, "success");
  assert.deepEqual(projection, {
    api_profile: "forgejo-v16",
    base_url: "https://forgejo.example",
    capabilities: { private_git_read: "verified" },
    health: "healthy",
    health_error: null,
    id: "connection-1",
    lifecycle: "enabled",
    polling: [
      {
        baseline_status: "complete",
        error: null,
        forge_repository_id: 11,
        last_success_at: 1_000,
        next_attempt_at: 61_000,
        rate_gate_until: null,
      },
    ],
    polling_failure: null,
    principal: { id: 7, login: "operator" },
    reported_version: "16.0.4",
    scopes: ["read:repository", "write:issue", "write:repository"],
    verified_at: 1_000,
  });
  assert.equal(
    core.get("SELECT count(*) AS count FROM repositories")?.count,
    1,
  );
  assert.equal(
    core.get("SELECT count(*) AS count FROM forgejo_repositories")?.count,
    1,
  );
  const credential = /** @type {{encrypted_credential: string}} */ (
    core.get("SELECT encrypted_credential FROM forgejo_connection_credentials")
  );
  assert.match(credential.encrypted_credential, /^v1\./);
  assert.doesNotMatch(credential.encrypted_credential, /operator-created-pat/);
  assert.doesNotMatch(
    JSON.stringify(core.get("SELECT * FROM forgejo_connection_verifications")),
    /operator-created-pat/,
  );
  assert.deepEqual(
    core.get(
      "SELECT trigger, error_code, error_message FROM forgejo_connection_verifications",
    ),
    { error_code: null, error_message: null, trigger: "onboarding" },
  );
  assert.deepEqual(
    core.get(
      `SELECT baseline_status, last_success_at, error_code,
              rate_gate_until, next_attempt_at, snapshot
         FROM forgejo_repository_polls`,
    ),
    {
      baseline_status: "complete",
      error_code: null,
      last_success_at: 1_000,
      next_attempt_at: 61_000,
      rate_gate_until: null,
      snapshot: "[]",
    },
  );
  assert.throws(
    () =>
      core.run(
        "UPDATE forgejo_connection_verifications SET verified_at = 2 WHERE id = 'verification-1'",
      ),
    /forgejo_connection_verification_immutable/,
  );
  assert.throws(
    () =>
      core.run(
        "DELETE FROM forgejo_connection_verifications WHERE id = 'verification-1'",
      ),
    /forgejo_connection_verification_immutable/,
  );
  service.destroy();
  core.close();
});

test("SQLite keeps the active Forgejo PAT when replacement verification fails", async (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-forgejo-rotation-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  let timestamp = 1_000;
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
    masterKey: Buffer.alloc(32, 3),
    now: () => timestamp,
    verifier: {
      async listPullRequests() {
        return [];
      },
      async verify({ token }) {
        if (token === "rejected-replacement") {
          throw Object.assign(
            new Error("Forgejo required route is unavailable: /api/v1/user"),
            { code: "forgejo_required_route_unavailable" },
          );
        }
        return {
          capabilities: { private_git_read: "verified" },
          principal: { id: 7, login: "operator" },
          profile: "forgejo-v16",
          reported_version: "16.0.4",
          repositories: [privateRepository],
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
  const original = /** @type {{encrypted_credential: string}} */ (
    core.get("SELECT encrypted_credential FROM forgejo_connection_credentials")
  ).encrypted_credential;

  timestamp = 2_000;
  await assert.rejects(
    () => service.rotate({ token: "rejected-replacement" }),
    { code: "forgejo_required_route_unavailable" },
  );
  assert.deepEqual(
    core.get("SELECT encrypted_credential FROM forgejo_connection_credentials"),
    { encrypted_credential: original },
  );
  assert.deepEqual(
    core.get("SELECT health, verified_at FROM forgejo_connections"),
    { health: "error", verified_at: 2_000 },
  );
  assert.deepEqual(service.read()?.health_error, {
    code: "forgejo_required_route_unavailable",
    message: "Forgejo required route is unavailable: /api/v1/user",
  });
  assert.equal(
    core.get("SELECT count(*) AS count FROM forgejo_connection_verifications")
      ?.count,
    2,
  );
  assert.deepEqual(
    core.get(
      `SELECT trigger, error_code, error_message, repositories
       FROM forgejo_connection_verifications
       WHERE id = 'verification-2'`,
    ),
    {
      error_code: "forgejo_required_route_unavailable",
      error_message: "Forgejo required route is unavailable: /api/v1/user",
      repositories: JSON.stringify([
        {
          error: {
            code: "forgejo_required_route_unavailable",
            message: "Forgejo required route is unavailable: /api/v1/user",
          },
          forge_repository_id: 11,
          outcome: "error",
        },
      ]),
      trigger: "rotation",
    },
  );
  timestamp = 3_000;
  const recovered =
    /** @type {NonNullable<Awaited<ReturnType<typeof service.read>>>} */ (
      await service.rotate({ token: "accepted-replacement" })
    );
  assert.equal(recovered?.health, "healthy");
  assert.equal(recovered?.health_error, null);
  assert.equal(recovered?.verified_at, 3_000);
  assert.equal(
    core.get("SELECT count(*) AS count FROM forgejo_connection_verifications")
      ?.count,
    3,
  );
  service.destroy();
  core.close();
});

test("SQLite atomically activates a replacement PAT only after every enabled Forgejo Repository verifies", async (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-forgejo-rotation-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  let timestamp = 1_000;
  const repositories = [
    {
      api_url: "https://forgejo.example/api/v1/repos/operator/active",
      clone_url: "https://forgejo.example/operator/active.git",
      full_name: "operator/active",
      html_url: "https://forgejo.example/operator/active",
      id: 11,
      outcome: "success",
      permissions: { admin: true, pull: true, push: true },
      private: true,
    },
    {
      api_url: "https://forgejo.example/api/v1/repos/operator/disabled",
      clone_url: "https://forgejo.example/operator/disabled.git",
      full_name: "operator/disabled",
      html_url: "https://forgejo.example/operator/disabled",
      id: 12,
      outcome: "success",
      permissions: { admin: true, pull: true, push: true },
      private: true,
    },
  ];
  const masterKey = Buffer.alloc(32, 4);
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
    masterKey,
    now: () => timestamp,
    verifier: {
      async listPullRequests() {
        return [];
      },
      async verify({ repositoryIds, token }) {
        assert.equal(
          token,
          timestamp === 1_000 ? "original-pat" : "replacement-pat",
        );
        assert.deepEqual(repositoryIds, timestamp === 1_000 ? [11, 12] : [11]);
        return {
          capabilities: { private_git_read: "verified" },
          principal: { id: 7, login: "operator" },
          profile: "forgejo-v16",
          reported_version: "16.0.5",
          repositories: repositories.filter((repository) =>
            repositoryIds.includes(repository.id),
          ),
          scopes: ["read:repository", "write:issue", "write:repository"],
        };
      },
    },
  });
  await service.connect({
    base_url: "https://forgejo.example",
    repository_ids: [11, 12],
    token: "original-pat",
  });
  core.run(
    "UPDATE repositories SET lifecycle = 'disabled' WHERE id = 'repository-2'",
  );
  timestamp = 2_000;
  const rotated =
    /** @type {NonNullable<Awaited<ReturnType<typeof service.read>>>} */ (
      await service.rotate({ token: "replacement-pat" })
    );
  assert.equal(rotated.verified_at, 2_000);
  assert.equal(rotated.reported_version, "16.0.5");
  assert.deepEqual(
    core.all(
      "SELECT verification_id FROM forgejo_repositories ORDER BY forge_repository_id",
    ),
    [
      { verification_id: "verification-2" },
      { verification_id: "verification-1" },
    ],
  );
  const credential = /** @type {{encrypted_credential: string}} */ (
    core.get("SELECT encrypted_credential FROM forgejo_connection_credentials")
  ).encrypted_credential;
  const cipher = createForgejoConnectionCredentialCipher(masterKey);
  assert.equal(cipher.decrypt("connection-1", credential), "replacement-pat");
  cipher.destroy();
  assert.equal(
    core.get("SELECT count(*) AS count FROM forgejo_connection_verifications")
      ?.count,
    2,
  );
  assert.deepEqual(
    core.get(
      `SELECT trigger, error_code, error_message
       FROM forgejo_connection_verifications
       WHERE id = 'verification-2'`,
    ),
    { error_code: null, error_message: null, trigger: "rotation" },
  );
  service.destroy();
  core.close();
});
