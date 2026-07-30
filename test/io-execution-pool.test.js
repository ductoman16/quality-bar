import assert from "node:assert/strict";
import test from "node:test";

import { createApplicationIoPool } from "../src/application-io-pool.js";
import {
  IO_EXECUTION_CONCURRENCY,
  IO_EXECUTION_QUEUE_CAPACITY,
  IoExecutionPoolError,
  createIoDutyScheduler,
  createIoExecutionPool,
} from "../src/io-execution-pool.js";

test("the fixed I/O pool bounds independent duties without hiding failures", async () => {
  assert.equal(IO_EXECUTION_CONCURRENCY, 4);
  let active = 0;
  let maximumActive = 0;
  /** @type {((value?: void) => void)[]} */
  const releases = [];
  const pool = createIoExecutionPool();
  const duties = /** @type {const} */ ([
    "polling",
    "acquisition",
    "delivery",
    "retention",
    "cleanup",
    "polling",
  ]);
  const tasks = duties.map(createTask);

  /** @param {(typeof duties)[number]} duty */
  function createTask(duty) {
    return pool.run(duty, async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => releases.push(resolve));
      active -= 1;
      return duty;
    });
  }

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(active, 4);
  releases.splice(0, 4).forEach((release) => release());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(active, 2);
  releases.splice(0).forEach((release) => release());
  assert.deepEqual(await Promise.all(tasks), [
    "polling",
    "acquisition",
    "delivery",
    "retention",
    "cleanup",
    "polling",
  ]);
  assert.equal(maximumActive, 4);

  const owningFailure = Object.assign(new Error("delivery failed exactly"), {
    code: "github_delivery_failed",
  });
  await assert.rejects(
    pool.run("delivery", () => {
      throw owningFailure;
    }),
    (error) => error === owningFailure,
  );
  assert.throws(
    () => pool.run(/** @type {any} */ ("other"), () => {}),
    /I\/O execution duty is invalid/,
  );
  await pool.close();
  assert.throws(
    () => pool.run("polling", () => {}),
    (error) =>
      error instanceof IoExecutionPoolError &&
      error.code === "io_execution_pool_closed" &&
      error.message === "I/O execution pool is closed",
  );
});

test("scheduled duties coalesce under saturation and cancellation prevents stale work after drain", async () => {
  const pool = createIoExecutionPool();
  /** @type {((value?: void) => void)[]} */
  const releases = [];
  const saturation = Array.from({ length: IO_EXECUTION_CONCURRENCY }, () =>
    pool.run(
      "acquisition",
      () => new Promise((resolve) => releases.push(resolve)),
    ),
  );
  await new Promise((resolve) => setImmediate(resolve));
  let deliveries = 0;
  const schedule = createIoDutyScheduler(pool, "delivery", () => {
    deliveries += 1;
  });
  const scheduled = Array.from({ length: 100 }, () => schedule());
  assert.equal(new Set(scheduled).size, 1);
  schedule.cancel();
  releases.splice(0).forEach((release) => release());
  await Promise.all([...saturation, ...scheduled]);
  assert.equal(deliveries, 0);
  await pool.close();
});

test("the fixed waiting bound and shutdown surface exact owning errors", async () => {
  assert.equal(IO_EXECUTION_QUEUE_CAPACITY, 16);
  const pool = createIoExecutionPool();
  /** @type {((value?: void) => void)[]} */
  const releases = [];
  const active = Array.from({ length: IO_EXECUTION_CONCURRENCY }, () =>
    pool.run("polling", () => new Promise((resolve) => releases.push(resolve))),
  );
  await new Promise((resolve) => setImmediate(resolve));
  const queued = Array.from({ length: IO_EXECUTION_QUEUE_CAPACITY }, () =>
    pool.run("cleanup", () => {}),
  );
  assert.throws(
    () => pool.run("retention", () => {}),
    (error) =>
      error instanceof IoExecutionPoolError &&
      error.code === "io_execution_capacity_unavailable" &&
      error.message === "I/O execution capacity is unavailable",
  );
  const closed = pool.close();
  releases.splice(0).forEach((release) => release());
  await Promise.all([...active, ...queued, closed]);
});

test("one application pool owns explicit acquisition and retention cleanup", async () => {
  const ioPool = createApplicationIoPool();
  let acquired = false;
  assert.deepEqual(
    await ioPool.acquireChangeset(
      {
        /** @param {string} repositoryId @param {any} request */
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

  /** @type {() => unknown} */
  let cleanup = () => assert.fail("retention cleanup was not configured");
  const storageReserve = ioPool.createStorageReserve(
    /** @param {any} options */
    (options) => {
      cleanup = options.cleanupEligibleData;
      return { status: "available" };
    },
    () => ({
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
  assert.deepEqual(cleanup(), { changes: 2 });
  await ioPool.close();
});
