import assert from "node:assert/strict";
import test from "node:test";

import { createApplicationIoPool } from "../src/application-io-pool.js";
import { createGitHubApiRequest } from "../src/github-api-request.js";
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
  assert.equal(active, 3);
  releases.splice(0, 3).forEach((release) => release());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(active, 3);
  releases.splice(0).forEach((release) => release());
  assert.deepEqual(await Promise.all(tasks), [
    "polling",
    "acquisition",
    "delivery",
    "retention",
    "cleanup",
    "polling",
  ]);
  assert.equal(maximumActive, 3);

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
  const saturation = Array.from({ length: IO_EXECUTION_CONCURRENCY - 1 }, () =>
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
  const active = Array.from({ length: IO_EXECUTION_CONCURRENCY - 1 }, () =>
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

test("hard shutdown aborts active duties and rejects queued duties with its owning error", async () => {
  const pool = createIoExecutionPool();
  let queuedRuns = 0;
  const active = Array.from({ length: IO_EXECUTION_CONCURRENCY - 1 }, () =>
    pool.run("polling", (signal) => {
      assert.ok(signal);
      const stopped = Promise.withResolvers();
      signal.addEventListener("abort", () => stopped.reject(signal.reason), {
        once: true,
      });
      return stopped.promise;
    }),
  );
  await new Promise((resolve) => setImmediate(resolve));
  const queued = pool.run("delivery", () => {
    queuedRuns += 1;
  });
  const failure = Object.assign(new Error("SQLite durable write failed"), {
    code: "storage_unavailable",
  });
  const activeRejections = Promise.all(
    active.map((completion) =>
      assert.rejects(completion, (error) => error === failure),
    ),
  );

  pool.shutdown(failure);

  await assert.rejects(queued, (error) => error === failure);
  await activeRejections;
  assert.equal(queuedRuns, 0);
});

test("hard shutdown settles an active production scheduler with its owning error", async () => {
  const pool = createIoExecutionPool();
  let observedReason;
  const schedule = createIoDutyScheduler(pool, "polling", (signal) => {
    assert.ok(signal);
    return new Promise((resolve) =>
      signal.addEventListener(
        "abort",
        () => {
          observedReason = signal.reason;
          resolve(undefined);
        },
        { once: true },
      ),
    );
  });
  const scheduled = schedule();
  const failure = Object.assign(new Error("SQLite durable write failed"), {
    code: "storage_unavailable",
  });
  await new Promise((resolve) => setImmediate(resolve));

  pool.shutdown(failure);

  await assert.rejects(scheduled, (error) => error === failure);
  assert.equal(observedReason, failure);
});

test("hard shutdown aborts production provider I/O before the pool drains", async () => {
  const pool = createIoExecutionPool();
  let fetchStopped = false;
  const request = createGitHubApiRequest(
    "https://api.github.test",
    /** @type {typeof fetch} */ (
      /** @type {unknown} */ (
        /**
         * @param {unknown} _url
         * @param {RequestInit | undefined} options
         */
        (_url, options) => {
          void _url;
          const stopped = Promise.withResolvers();
          const signal = options?.signal;
          assert.ok(signal);
          signal.addEventListener(
            "abort",
            () => {
              fetchStopped = true;
              stopped.reject(signal.reason);
            },
            { once: true },
          );
          return stopped.promise;
        }
      )
    ),
  );
  const completion = pool.run("delivery", () => request("/provider-duty"));
  const failure = Object.assign(new Error("SQLite durable write failed"), {
    code: "storage_unavailable",
  });
  const completionRejection = assert.rejects(
    completion,
    (error) => error === failure,
  );
  await new Promise((resolve) => setImmediate(resolve));
  const closed = pool.close();

  pool.shutdown(failure);

  await completionRejection;
  await closed;
  assert.equal(fetchStopped, true);
});

test("hard shutdown waits for non-cooperative work and replaces its late success", async () => {
  const pool = createIoExecutionPool();
  const operation = Promise.withResolvers();
  const completion = pool.run("delivery", () => operation.promise);
  const failure = Object.assign(new Error("SQLite durable write failed"), {
    code: "storage_unavailable",
  });
  const completionRejection = assert.rejects(
    completion,
    (error) => error === failure,
  );
  await new Promise((resolve) => setImmediate(resolve));
  let drained = false;
  const closed = pool.close().then(() => {
    drained = true;
  });

  pool.shutdown(failure);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(drained, false);
  operation.resolve("stale product result");

  await completionRejection;
  await closed;
  assert.equal(drained, true);
});

test("same-turn hard shutdown prevents promoted work from starting", async () => {
  const pool = createIoExecutionPool();
  let started = false;
  const completion = pool.run("delivery", () => {
    started = true;
  });
  const failure = Object.assign(new Error("SQLite durable write failed"), {
    code: "storage_unavailable",
  });

  pool.shutdown(failure);

  await assert.rejects(completion, (error) => error === failure);
  await pool.close();
  assert.equal(started, false);
});

test("application acquisition preserves hard shutdown over a wrapped late failure", async () => {
  const ioPool = createApplicationIoPool({
    reportBackgroundFailure: (error) =>
      assert.fail(/** @type {Error} */ (error)),
  });
  const acquisition = Promise.withResolvers();
  const completion = ioPool.acquireChangeset(
    {
      resolvePushedSelectors() {
        return acquisition.promise;
      },
    },
    "repository-1",
    { head: "main" },
  );
  const failure = Object.assign(new Error("SQLite durable write failed"), {
    code: "storage_unavailable",
  });
  await new Promise((resolve) => setImmediate(resolve));

  ioPool.shutdown(failure);
  acquisition.reject(new Error("evaluation_git_acquisition_failed"));

  await assert.rejects(completion, (error) => error === failure);
  await ioPool.close();
});

test("application acquisition preserves a distinct Git termination failure", async () => {
  const ioPool = createApplicationIoPool({
    reportBackgroundFailure: (error) =>
      assert.fail(/** @type {Error} */ (error)),
  });
  const acquisition = Promise.withResolvers();
  const completion = ioPool.acquireChangeset(
    { resolvePushedSelectors: () => acquisition.promise },
    "repository-1",
    { head: "main" },
  );
  const storageFailure = Object.assign(
    new Error("SQLite durable write failed"),
    { code: "storage_unavailable" },
  );
  const terminationFailure = Object.assign(
    new Error("Git process termination failed"),
    { code: "git_termination_failed" },
  );
  await new Promise((resolve) => setImmediate(resolve));

  ioPool.shutdown(storageFailure);
  acquisition.reject(terminationFailure);

  await assert.rejects(completion, (error) => error === terminationFailure);
  await ioPool.close();
});

test("a saturated production scheduler reports its exact admission failure", async () => {
  /** @type {any[]} */
  const failures = [];
  const pool = createIoExecutionPool({
    reportBackgroundFailure: (error) => failures.push(error),
  });
  /** @type {((value?: void) => void)[]} */
  const releases = [];
  const active = Array.from({ length: IO_EXECUTION_CONCURRENCY - 1 }, () =>
    pool.run("polling", () => new Promise((resolve) => releases.push(resolve))),
  );
  await new Promise((resolve) => setImmediate(resolve));
  const queued = Array.from({ length: IO_EXECUTION_QUEUE_CAPACITY }, () =>
    pool.run("acquisition", () => {}),
  );
  const schedule = createIoDutyScheduler(pool, "delivery", () => {});
  schedule.background();
  assert.equal(failures.length, 1);
  assert.equal(failures[0]?.code, "io_execution_capacity_unavailable");
  releases.splice(0).forEach((release) => release());
  await Promise.all([...active, ...queued, pool.close()]);
});
