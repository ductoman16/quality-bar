import assert from "node:assert/strict";
import { test } from "node:test";

import { createApplicationIoPool } from "../src/application-io-pool.js";
import { IO_EXECUTION_CONCURRENCY } from "../src/io-execution-pool.js";

test("one application pool owns explicit acquisition and eligible cleanup", async () => {
  const ioPool = createApplicationIoPool({
    cleanupOwnedArtifacts({ checkoutRoot, durableCore }) {
      assert.equal(checkoutRoot, "/var/cache/quality-bar/checkouts");
      assert.equal(typeof durableCore.all, "function");
      return { removed: 3 };
    },
    reportBackgroundFailure: (error) =>
      assert.fail(/** @type {Error} */ (error)),
  });
  let acquired = false;
  assert.deepEqual(
    await ioPool.acquireChangeset(
      {
        /** @param {string} repositoryId @param {unknown} request */
        resolvePushedSelectors(repositoryId, request) {
          acquired = true;
          return { repositoryId, request };
        },
      },
      "repository-1",
      { head: "main" },
    ),
    { repositoryId: "repository-1", request: { head: "main" } },
  );
  assert.equal(acquired, true);
  assert.throws(
    () => ioPool.acquireChangeset(null, "repository-1", {}),
    /Repository service is unavailable/,
  );

  let cleanup = () => assert.fail("eligible cleanup was not configured");
  const storageReserve = ioPool.createStorageReserve(
    /** @param {any} options */
    (options) => {
      cleanup = options.cleanupEligibleData;
      return { status: "available" };
    },
    () => ({
      all() {
        return [];
      },
      /** @param {(transaction: any) => unknown} callback */
      transaction(callback) {
        return callback({
          /** @param {string} sql */
          run(sql) {
            assert.match(sql, /DELETE FROM browser_sessions/);
            return { changes: 2 };
          },
        });
      },
    }),
    () => 1_000_000,
    5 * 1024 ** 3,
  );
  assert.equal(storageReserve.ioPool.run, ioPool.run);
  assert.deepEqual(cleanup(), {
    artifacts: { removed: 3 },
    sessions: { changes: 2 },
  });
  await ioPool.close();
});

test("required eligible cleanup keeps one bounded slot under ordinary I/O saturation", async () => {
  const ioPool = createApplicationIoPool({
    cleanupOwnedArtifacts: () => ({ removed: 1 }),
    reportBackgroundFailure: (error) =>
      assert.fail(/** @type {Error} */ (error)),
  });
  /** @type {((value?: void) => void)[]} */
  const releases = [];
  const active = Array.from({ length: IO_EXECUTION_CONCURRENCY - 1 }, () =>
    ioPool.run(
      "acquisition",
      () => new Promise((resolve) => releases.push(resolve)),
    ),
  );
  await new Promise((resolve) => setImmediate(resolve));
  let cleanup = () => {};
  ioPool.createStorageReserve(
    (/** @type {any} */ options) => {
      cleanup = options.cleanupEligibleData;
      return {};
    },
    () => ({
      all() {
        return [];
      },
      /** @param {(transaction: any) => unknown} callback */
      transaction(callback) {
        return callback({ run: () => ({ changes: 1 }) });
      },
    }),
    () => 0,
    1,
  );
  assert.deepEqual(cleanup(), {
    artifacts: { removed: 1 },
    sessions: { changes: 1 },
  });
  releases.splice(0).forEach((release) => release());
  await Promise.all([...active, ioPool.close()]);
});
