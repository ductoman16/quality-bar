import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDurableCore } from "../src/durable-core.js";
import { createForgejoConnectionService } from "../src/forgejo-connection.js";
import { StorageReserveError } from "../src/storage-reserve.js";
import {
  forgejoVerification,
  repositoryEvidence,
} from "./forgejo-polling-sqlite-integration-support.js";

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
  let loseReserveAfterProviderRead = false;
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
  loseReserveAfterProviderRead = false;
  await service.runPolling();
  assert.equal(providerRequests, 3);
  assert.equal(
    core.get("SELECT last_success_at FROM forgejo_repository_polls")
      ?.last_success_at,
    61_000,
  );
  service.destroy();
  core.close();
});
