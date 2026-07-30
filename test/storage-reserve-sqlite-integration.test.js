import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import {
  BROWSER_SESSION_ABSOLUTE_LIFETIME_MS,
  removeExpiredBrowserSessions,
} from "../src/browser-session.js";
import { createForgejoConnectionService } from "../src/forgejo-connection.js";
import { GitHubConnectionError } from "../src/github-connection-error.js";
import { createGitHubPollingRunner } from "../src/github-polling-runner.js";
import { createIoExecutionPool } from "../src/io-execution-pool.js";
import { createStorageReservePollingCore } from "../src/storage-reserve-polling-core.js";
import {
  createStorageReserveGate,
  StorageReserveError,
} from "../src/storage-reserve.js";
import {
  cleanupOwnedTemporaryArtifacts,
  OwnedArtifactCleanupError,
} from "../src/owned-artifact-cleanup.js";
import {
  forgejoVerification,
  repositoryEvidence,
} from "./forgejo-polling-sqlite-integration-support.js";
import {
  githubAutomaticEvaluationTestDependencies,
  seedDueGitHubPoll,
} from "./storage-reserve-support.js";

/** @param {number} number */
function pullRequest(number) {
  return {
    base: { sha: number.toString(16).padStart(40, "a") },
    draft: false,
    head: { sha: number.toString(16).padStart(40, "b") },
    merged: false,
    merged_at: null,
    number,
    state: "open",
  };
}

test("eligible cleanup commits before a low-reserve polling transaction is rejected", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-reserve-cleanup-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  const now = BROWSER_SESSION_ABSOLUTE_LIFETIME_MS + 1;
  core.run(
    "INSERT INTO browser_sessions (session_hash, csrf_hash, created_at, last_authenticated_at) VALUES (?, ?, ?, ?)",
    "expired",
    "expired-csrf",
    0,
    0,
  );
  const gate = createStorageReserveGate({
    checkoutsPath: "/checkouts",
    cleanupEligibleData: () =>
      removeExpiredBrowserSessions(core, { now: () => now }),
    reserveBytes: 2,
    statePath: "/state",
    statfs: () => ({ bavail: 1, bsize: 1 }),
  });
  let transactionStarted = false;

  assert.throws(
    () =>
      createStorageReservePollingCore(core, gate).transaction(() => {
        transactionStarted = true;
      }),
    (error) =>
      error instanceof StorageReserveError &&
      error.code === "storage_reserve_unavailable",
  );
  assert.equal(transactionStarted, false);
  assert.deepEqual(core.all("SELECT session_hash FROM browser_sessions"), []);
  core.close();
});

test("SQLite-backed cleanup deletes an absent owned checkout before reserve rejection", (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-owned-cleanup-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const checkoutRoot = join(directory, "checkouts");
  const orphan = join(checkoutRoot, "absent-work", "1", "checkout");
  mkdirSync(orphan, { recursive: true });
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  const gate = createStorageReserveGate({
    checkoutsPath: checkoutRoot,
    cleanupEligibleData: () =>
      cleanupOwnedTemporaryArtifacts({ checkoutRoot, durableCore: core }),
    reserveBytes: 2,
    statePath: join(directory, "state"),
    statfs: () => ({ bavail: 1, bsize: 1 }),
  });

  assert.throws(
    () => gate.assertWorkAdmissionAvailable(),
    (error) =>
      error instanceof StorageReserveError &&
      error.code === "storage_reserve_unavailable",
  );
  assert.equal(existsSync(join(checkoutRoot, "absent-work")), false);
  core.close();
});

test("a SQLite cleanup owner-read failure blocks admission, starts, and polling advancement", (context) => {
  const directory = mkdtempSync(
    join(tmpdir(), "quality-bar-owned-cleanup-failure-"),
  );
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const checkoutRoot = join(directory, "checkouts");
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  core.run("DROP TABLE codex_execution_queue");
  const gate = createStorageReserveGate({
    checkoutsPath: checkoutRoot,
    cleanupEligibleData: () =>
      cleanupOwnedTemporaryArtifacts({ checkoutRoot, durableCore: core }),
    reserveBytes: 2,
    statePath: join(directory, "state"),
    statfs: () => ({ bavail: 1, bsize: 1 }),
  });

  for (const run of [
    () => gate.assertWorkAdmissionAvailable(),
    () => gate.assertCodexStartAvailable(),
    () => gate.preparePollingObservationAdvance(),
  ]) {
    assert.throws(run, (error) => {
      assert.ok(error instanceof OwnedArtifactCleanupError);
      const cause = /** @type {{code?: string, message?: string}} */ (
        error.cause
      );
      assert.equal(error.code, "owned_artifact_cleanup_owner_read_failed");
      assert.equal(cause.code, "ERR_SQLITE_ERROR");
      assert.match(cause.message ?? "", /no such table/i);
      return true;
    });
  }
  core.close();
});

test("SQLite polling advances no observation while the runtime reserve is unavailable", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-forgejo-reserve-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  let reserveAvailable = true;
  /** @type {number | null} */
  let reserveChecksBeforeLoss = null;
  let loseReserveAfterProviderRead = false;
  let providerFailure = false;
  let providerRequests = 0;
  let currentTime = 1_000;
  function assertReserveAvailable() {
    if (reserveChecksBeforeLoss !== null) {
      if (reserveChecksBeforeLoss === 0) {
        reserveAvailable = false;
      } else {
        reserveChecksBeforeLoss -= 1;
      }
    }
    if (!reserveAvailable) {
      throw new StorageReserveError(
        "storage_reserve_unavailable",
        "A required runtime filesystem is below the free-space reserve",
        {
          action: "polling_observation_advancement",
          facts: {
            filesystems: [
              {
                available_bytes: 4 * 1024 ** 3,
                filesystem: "state",
                path: "/var/lib/quality-bar",
                status: "unavailable",
              },
            ],
            reserve_bytes: 5 * 1024 ** 3,
            status: "unavailable",
          },
        },
      );
    }
  }
  const service = createForgejoConnectionService(core, {
    createId: (() => {
      const ids = ["connection-1", "verification-1", "repository-1"];
      return () => ids.shift();
    })(),
    masterKey: Buffer.alloc(32, 23),
    now: () => currentTime,
    storageReserve: {
      assertPollingObservationAdvanceAvailable: assertReserveAvailable,
      ioPool: createIoExecutionPool(),
      preparePollingObservationAdvance: assertReserveAvailable,
    },
    verifier: {
      async listPullRequests() {
        providerRequests += 1;
        if (loseReserveAfterProviderRead) {
          reserveAvailable = false;
        }
        if (providerFailure) {
          throw Object.assign(new Error("Forgejo provider failed"), {
            code: "forgejo_api_transient_failure",
            nextAttemptAt: 125_000,
          });
        }
        return [pullRequest(providerRequests)];
      },
      async verify() {
        return forgejoVerification([repositoryEvidence(11, "private")]);
      },
    },
  });
  await service.connect({
    base_url: "https://forgejo.example",
    repository_ids: [11],
    token: "pat",
  });
  const before = core.get(
    `SELECT last_success_at, next_attempt_at, snapshot
       FROM forgejo_repository_polls`,
  );

  currentTime = 61_000;
  reserveAvailable = false;
  await assert.rejects(
    () => service.runPolling(),
    (error) =>
      error instanceof StorageReserveError &&
      error.code === "storage_reserve_unavailable",
  );
  assert.equal(providerRequests, 1);
  assert.deepEqual(
    core.get(
      `SELECT last_success_at, next_attempt_at, snapshot
         FROM forgejo_repository_polls`,
    ),
    before,
  );

  reserveAvailable = true;
  loseReserveAfterProviderRead = true;
  await assert.rejects(
    () => service.runPolling(),
    (error) =>
      error instanceof StorageReserveError &&
      error.code === "storage_reserve_unavailable",
  );
  assert.equal(providerRequests, 2);
  assert.deepEqual(
    core.get(
      `SELECT last_success_at, next_attempt_at, snapshot
         FROM forgejo_repository_polls`,
    ),
    before,
  );

  reserveAvailable = true;
  providerFailure = true;
  await assert.rejects(
    () => service.runPolling(),
    (error) =>
      error instanceof StorageReserveError &&
      error.code === "storage_reserve_unavailable",
  );
  assert.equal(providerRequests, 3);
  assert.deepEqual(
    core.get(
      `SELECT last_success_at, next_attempt_at, snapshot
         FROM forgejo_repository_polls`,
    ),
    before,
  );

  reserveAvailable = true;
  loseReserveAfterProviderRead = false;
  providerFailure = false;
  await service.runPolling();
  assert.equal(providerRequests, 4);
  assert.equal(
    core.get("SELECT last_success_at FROM forgejo_repository_polls")
      ?.last_success_at,
    61_000,
  );

  const afterSuccess = core.get(
    `SELECT last_success_at, next_attempt_at, snapshot
       FROM forgejo_repository_polls`,
  );
  core.run(
    "UPDATE forgejo_connection_credentials SET encrypted_credential = ?",
    "invalid-envelope",
  );
  currentTime = 121_000;
  reserveChecksBeforeLoss = 1;
  await assert.rejects(
    () => service.runPolling(),
    (error) =>
      error instanceof StorageReserveError &&
      error.code === "storage_reserve_unavailable",
  );
  assert.deepEqual(
    core.get(
      `SELECT last_success_at, next_attempt_at, snapshot
         FROM forgejo_repository_polls`,
    ),
    afterSuccess,
  );
  assert.deepEqual(core.get("SELECT health FROM forgejo_connections"), {
    health: "healthy",
  });
  service.destroy();
  core.close();
});

test("GitHub provider and credential failures advance nothing after reserve loss", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "quality-bar-github-reserve-"));
  context.after(() => rmSync(directory, { force: true, recursive: true }));
  const core = openDurableCore(join(directory, "quality-bar.sqlite3"));
  seedDueGitHubPoll(core);
  let checksBeforeLoss = 1;
  let credentialFailure = false;
  let providerFailure = true;
  function assertReserveAvailable() {
    if (checksBeforeLoss-- <= 0) {
      throw new StorageReserveError(
        "storage_reserve_unavailable",
        "A required runtime filesystem is below the free-space reserve",
        { action: "polling_observation_advancement" },
      );
    }
  }
  const runner = createGitHubPollingRunner(core, {
    ...githubAutomaticEvaluationTestDependencies,
    cipher: {
      decrypt() {
        if (credentialFailure) {
          throw Object.assign(new Error("GitHub credential failed"), {
            code: "github_connection_credential_undecryptable",
          });
        }
        return { client_id: null, pem: "private-key" };
      },
    },
    storageReserve: {
      assertPollingObservationAdvanceAvailable: assertReserveAvailable,
      ioPool: createIoExecutionPool(),
      preparePollingObservationAdvance: assertReserveAvailable,
    },
    timestamp: () => 65_000,
    verifier: {
      async listPullRequests() {
        if (providerFailure) {
          throw new GitHubConnectionError(
            "github_api_transient_failure",
            "GitHub provider failed",
          );
        }
        return [pullRequest(2)];
      },
      async verifyRepositories() {
        throw new Error("repository selection is not exercised");
      },
    },
  });
  const before = core.get(
    "SELECT last_success_at, next_attempt_at, error_code, snapshot FROM github_repository_polls",
  );

  await assert.rejects(
    () => runner.runDue(),
    (error) =>
      error instanceof StorageReserveError &&
      error.code === "storage_reserve_unavailable",
  );
  assert.deepEqual(
    core.get(
      "SELECT last_success_at, next_attempt_at, error_code, snapshot FROM github_repository_polls",
    ),
    before,
  );

  providerFailure = false;
  credentialFailure = true;
  checksBeforeLoss = 1;
  await assert.rejects(
    () => runner.runDue(),
    (error) =>
      error instanceof StorageReserveError &&
      error.code === "storage_reserve_unavailable",
  );
  assert.deepEqual(
    core.get(
      "SELECT last_success_at, next_attempt_at, error_code, snapshot FROM github_repository_polls",
    ),
    before,
  );
  assert.deepEqual(core.get("SELECT health FROM github_connections"), {
    health: "healthy",
  });
  runner.destroy();
  core.close();
});
