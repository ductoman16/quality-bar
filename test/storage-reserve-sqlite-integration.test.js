import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { createForgejoConnectionService } from "../src/forgejo-connection.js";
import { GitHubConnectionError } from "../src/github-connection-error.js";
import { createGitHubPollingRunner } from "../src/github-polling-runner.js";
import { StorageReserveError } from "../src/storage-reserve.js";
import {
  forgejoVerification,
  repositoryEvidence,
} from "./forgejo-polling-sqlite-integration-support.js";
import { seedDueGitHubPoll } from "./storage-reserve-support.js";

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
  const service = createForgejoConnectionService(core, {
    createId: (() => {
      const ids = ["connection-1", "verification-1", "repository-1"];
      return () => ids.shift();
    })(),
    masterKey: Buffer.alloc(32, 23),
    now: () => currentTime,
    storageReserve: {
      assertPollingObservationAdvanceAvailable() {
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
      },
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
  const runner = createGitHubPollingRunner(core, {
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
      assertPollingObservationAdvanceAvailable() {
        if (checksBeforeLoss-- <= 0) {
          throw new StorageReserveError(
            "storage_reserve_unavailable",
            "A required runtime filesystem is below the free-space reserve",
            { action: "polling_observation_advancement" },
          );
        }
      },
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
