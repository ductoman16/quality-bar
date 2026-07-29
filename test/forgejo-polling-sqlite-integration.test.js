import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createForgejoConnectionService } from "../src/forgejo-connection.js";
import { openDurableCore } from "../src/durable-core.js";
import { createRepositoryService } from "../src/repository.js";
import {
  createOneShotForgejoBaselineFailure,
  forgejoVerification,
  pullRequest,
  repositoryEvidence,
} from "./forgejo-polling-sqlite-integration-support.js";
import { availableStorageReserve } from "./storage-reserve-support.js";

test("SQLite onboarding advances nothing when the complete Forgejo baseline fails", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-forgejo-polling-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  const baselineFailure = Object.assign(
    new Error("Forgejo pull-request polling response is invalid"),
    { code: "forgejo_poll_response_invalid", repositoryId: 11 },
  );
  const service = createForgejoConnectionService(core, {
    createId: () => "connection-1",
    masterKey: Buffer.alloc(32, 15),
    now: () => 1_000,
    storageReserve: availableStorageReserve,
    verifier: {
      async listPullRequests() {
        throw baselineFailure;
      },
      async verify() {
        return {
          capabilities: { private_git_read: "verified" },
          principal: { id: 7, login: "operator" },
          profile: "forgejo-v16",
          reported_version: "16.0.4",
          repositories: [
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
          ],
          scopes: ["read:repository", "write:issue", "write:repository"],
        };
      },
    },
  });

  await assert.rejects(
    () =>
      service.connect({
        base_url: "https://forgejo.example",
        repository_ids: [11],
        token: "operator-created-pat",
      }),
    (error) => error === baselineFailure,
  );
  assert.deepEqual(
    ["forgejo_connections", "repositories", "forgejo_repository_polls"].map(
      (table) => core.get(`SELECT count(*) AS count FROM ${table}`)?.count,
    ),
    [0, 0, 0],
  );
  service.destroy();
  core.close();
});

test("SQLite polling preserves the last Forgejo success through an exact rate gate", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-forgejo-polling-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  let currentTime = 1_000;
  let observed = [pullRequest(1)];
  /** @type {Error & {code: string, nextAttemptAt: number, repositoryId: number} | null} */
  let failure = null;
  const service = createForgejoConnectionService(core, {
    createId: (() => {
      const ids = ["connection-1", "verification-1", "repository-1"];
      return () => ids.shift();
    })(),
    masterKey: Buffer.alloc(32, 20),
    now: () => currentTime,
    storageReserve: availableStorageReserve,
    verifier: {
      async listPullRequests() {
        if (failure) {
          throw failure;
        }
        return observed;
      },
      async verify() {
        return {
          capabilities: { private_git_read: "verified" },
          principal: { id: 7, login: "operator" },
          profile: "forgejo-v16",
          reported_version: "16.0.4",
          repositories: [
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
          ],
          scopes: ["read:repository", "write:issue", "write:repository"],
        };
      },
    },
  });
  await service.connect({
    base_url: "https://forgejo.example",
    repository_ids: [11],
    token: "pat",
  });

  currentTime = 61_000;
  failure = Object.assign(new Error("Forgejo polling rate limited"), {
    code: "forgejo_api_rate_limited",
    nextAttemptAt: 125_000,
    rateGateUntil: 125_000,
    repositoryId: 11,
  });
  await service.runPolling();
  assert.deepEqual(
    core.get(
      `SELECT baseline_status, last_success_at, error_code, error_message,
              rate_gate_until, next_attempt_at, snapshot
         FROM forgejo_repository_polls`,
    ),
    {
      baseline_status: "complete",
      error_code: "forgejo_api_rate_limited",
      error_message: "Forgejo polling rate limited",
      last_success_at: 1_000,
      next_attempt_at: 125_000,
      rate_gate_until: 125_000,
      snapshot: JSON.stringify([pullRequest(1)]),
    },
  );

  currentTime = 125_000;
  failure = null;
  observed = [pullRequest(2)];
  await service.runPolling();
  assert.deepEqual(
    core.get(
      `SELECT baseline_status, last_success_at, error_code,
              rate_gate_until, next_attempt_at, snapshot
         FROM forgejo_repository_polls`,
    ),
    {
      baseline_status: "complete",
      error_code: null,
      last_success_at: 125_000,
      next_attempt_at: 185_000,
      rate_gate_until: null,
      snapshot: JSON.stringify([pullRequest(2)]),
    },
  );
  service.destroy();
  core.close();
});

test("a current-schema restart atomically rebaselines every Forgejo Repository", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-forgejo-restore-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const databasePath = join(directory, "quality-bar.sqlite3");
  const masterKey = Buffer.alloc(32, 21);
  const repositories = [
    repositoryEvidence(11, "one"),
    repositoryEvidence(22, "two"),
  ];
  let currentTime = 1_000;
  const initial = openDurableCore(databasePath);
  const onboarding = createForgejoConnectionService(initial, {
    createId: (() => {
      const ids = [
        "connection-1",
        "verification-1",
        "repository-1",
        "repository-2",
      ];
      return () => ids.shift();
    })(),
    masterKey,
    now: () => currentTime,
    storageReserve: availableStorageReserve,
    verifier: {
      async listPullRequests(connection, repository) {
        assert.equal(connection.baseUrl, "https://forgejo.example");
        return [pullRequest(repository.id)];
      },
      async verify() {
        return forgejoVerification(repositories);
      },
    },
  });
  await onboarding.connect({
    base_url: "https://forgejo.example",
    repository_ids: [11, 22],
    token: "pat",
  });
  onboarding.destroy();
  initial.close();

  currentTime = 61_000;
  const baselineFailure = createOneShotForgejoBaselineFailure([11, 22], 22);
  const restoredCore = openDurableCore(databasePath);
  const restored = createForgejoConnectionService(restoredCore, {
    masterKey,
    now: () => currentTime,
    storageReserve: availableStorageReserve,
    verifier: {
      async listPullRequests(connection, repository) {
        if (baselineFailure.fails(repository.id, connection.baseUrl)) {
          throw Object.assign(new Error("Forgejo Repository is forbidden"), {
            code: "forgejo_repository_permission_denied",
            repositoryId: 22,
          });
        }
        return [pullRequest(repository.id + 100)];
      },
      async verify({ repositoryIds }) {
        return forgejoVerification(
          repositories.filter(({ id }) => repositoryIds.includes(id)),
        );
      },
    },
  });
  restored.requireFreshBaseline();
  assert.deepEqual(
    restoredCore.all(
      `SELECT baseline_status, last_success_at, next_attempt_at
         FROM forgejo_repository_polls ORDER BY forge_repository_id`,
    ),
    [
      {
        baseline_status: "pending",
        last_success_at: 1_000,
        next_attempt_at: 0,
      },
      {
        baseline_status: "pending",
        last_success_at: 1_000,
        next_attempt_at: 0,
      },
    ],
  );

  await restored.runPolling();
  assert.deepEqual(
    restoredCore.all(
      `SELECT baseline_status, last_success_at, error_code, next_attempt_at,
              snapshot
         FROM forgejo_repository_polls ORDER BY forge_repository_id`,
    ),
    [
      {
        baseline_status: "pending",
        error_code: null,
        last_success_at: 1_000,
        next_attempt_at: Number.MAX_SAFE_INTEGER,
        snapshot: JSON.stringify([pullRequest(11)]),
      },
      {
        baseline_status: "error",
        error_code: "forgejo_repository_permission_denied",
        last_success_at: 1_000,
        next_attempt_at: null,
        snapshot: JSON.stringify([pullRequest(22)]),
      },
    ],
  );

  currentTime = 125_000;
  baselineFailure.correct();
  const lifecycle = createRepositoryService(restoredCore, {
    masterKey,
    now: () => currentTime,
    verifyForgeRepository: (forgeRepositoryId) =>
      restored.prepareRepositoryEnablement(forgeRepositoryId),
  });
  await lifecycle.setLifecycle("repository-2", { lifecycle: "disabled" });
  await lifecycle.setLifecycle("repository-2", { lifecycle: "enabled" });
  assert.deepEqual(
    restoredCore.all(
      `SELECT baseline_status, last_success_at, error_code, next_attempt_at
         FROM forgejo_repository_polls ORDER BY forge_repository_id`,
    ),
    [
      {
        baseline_status: "complete",
        error_code: null,
        last_success_at: 125_000,
        next_attempt_at: 185_000,
      },
      {
        baseline_status: "complete",
        error_code: null,
        last_success_at: 125_000,
        next_attempt_at: 185_000,
      },
    ],
  );
  lifecycle.destroy();
  restored.destroy();
  restoredCore.close();
});
