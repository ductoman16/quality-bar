import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FORGEJO_POLL_INTERVAL_MS,
  createForgejoPollingService,
  nextForgejoAttemptAt,
} from "../src/forgejo/forgejo-polling.js";

/** @param {number} number */
function pullRequest(number) {
  return {
    base: { sha: number.toString(16).padStart(40, "a") },
    draft: false,
    head: { sha: number.toString(16).padStart(40, "b") },
    merge_base: number.toString(16).padStart(40, "c"),
    merged: false,
    merged_at: null,
    number,
    state: "open",
  };
}

test("Forgejo polling targets sixty seconds and preserves provider gates", () => {
  assert.equal(FORGEJO_POLL_INTERVAL_MS, 60_000);
  assert.equal(nextForgejoAttemptAt(5_000, {}), 65_000);
  assert.equal(
    nextForgejoAttemptAt(5_000, { nextAttemptAt: 125_000 }),
    125_000,
  );
  assert.equal(
    nextForgejoAttemptAt(5_000, {
      code: "forgejo_connection_credential_invalid",
    }),
    null,
  );
});

test("a complete Forgejo baseline prepares every Repository without writing", async () => {
  /** @type {{parameters: unknown[], sql: string}[]} */
  const writes = [];
  /** @type {number[]} */
  const requested = [];
  const core = {
    all() {
      return [];
    },
    /** @param {(transaction: any) => unknown} callback */
    transaction(callback) {
      return callback({
        /** @param {string} sql @param {...unknown} parameters */
        run(sql, ...parameters) {
          writes.push({ parameters, sql });
        },
      });
    },
  };
  const polling = createForgejoPollingService(core, {
    async fetchPullRequests({ repository }) {
      requested.push(repository.id);
      return [pullRequest(repository.id)];
    },
    now: (() => {
      const timestamps = [5_000, 6_000];
      return () => /** @type {number} */ (timestamps.shift());
    })(),
    recordOwningFailure() {},
  });

  const prepared = await polling.prepare(
    {
      connection: { id: "connection-1" },
      credential: { token: "pat" },
      repositories: [
        { full_name: "operator/one", id: 101 },
        { full_name: "operator/two", id: 202 },
      ],
    },
    { baseline: true },
  );

  assert.deepEqual(requested, [101, 202]);
  assert.deepEqual(writes, []);
  assert.equal(prepared.completedAt, 6_000);
  assert.deepEqual(
    prepared.snapshots.map(({ forgeRepositoryId }) => forgeRepositoryId),
    [101, 202],
  );
});

test("a partial Forgejo baseline commits no snapshot", async () => {
  /** @type {{parameters: unknown[], sql: string}[]} */
  const writes = [];
  const failure = Object.assign(new Error("second page failed"), {
    code: "forgejo_api_transient_failure",
    nextAttemptAt: 125_000,
    repositoryId: 202,
  });
  const polling = createForgejoPollingService(
    {
      all() {
        return [];
      },
      /** @param {(transaction: any) => unknown} callback */
      transaction(callback) {
        return callback({
          get() {
            return undefined;
          },
          /** @param {string} sql @param {...unknown} parameters */
          run(sql, ...parameters) {
            writes.push({ parameters, sql });
          },
        });
      },
    },
    {
      async fetchPullRequests({ repository }) {
        if (repository.id === 202) {
          throw failure;
        }
        return [pullRequest(101)];
      },
      now: () => 5_000,
      recordOwningFailure() {},
    },
  );

  await assert.rejects(
    () =>
      polling.prepare(
        {
          connection: { id: "connection-1" },
          credential: { token: "pat" },
          repositories: [
            { full_name: "operator/one", id: 101 },
            { full_name: "operator/two", id: 202 },
          ],
        },
        { baseline: true },
      ),
    (error) => error === failure,
  );
  assert.equal(
    writes.some(({ sql }) => sql.includes("snapshot")),
    false,
  );
});
