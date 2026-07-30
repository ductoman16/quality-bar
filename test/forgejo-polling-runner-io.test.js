import assert from "node:assert/strict";
import test from "node:test";

import { createForgejoPollingRunner } from "../src/forgejo-polling-runner.js";
import {
  IO_EXECUTION_CONCURRENCY,
  IO_EXECUTION_QUEUE_CAPACITY,
  createIoExecutionPool,
} from "../src/io-execution-pool.js";
import { FORGEJO_POLL_INTERVAL_MS } from "../src/forgejo-polling.js";

test("the actual Forgejo one-shot scheduler remains due after I/O saturation", async () => {
  /** @type {any[]} */
  const failures = [];
  const ioPool = createIoExecutionPool({
    reportBackgroundFailure: (error) => failures.push(error),
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
  const queued = Array.from({ length: IO_EXECUTION_QUEUE_CAPACITY }, () =>
    ioPool.run("cleanup", () => {}),
  );
  /** @type {{callback: () => void, delay: number, unref: () => void}[]} */
  const timers = [];
  const runner = createForgejoPollingRunner(
    {
      all: () => [],
      /** @param {(transaction: any) => unknown} callback */
      transaction: (callback) =>
        callback({
          all: () => [],
          get: () => undefined,
          run: () => ({ changes: 0 }),
        }),
    },
    {
      cipher: { decrypt: assert.fail },
      /** @param {() => void} callback @param {number} delay */
      setTimer(callback, delay) {
        const timer = { callback, delay, unref() {} };
        timers.push(timer);
        return timer;
      },
      storageReserve: {
        assertPollingObservationAdvanceAvailable() {},
        ioPool,
        preparePollingObservationAdvance() {},
      },
      timestamp: () => 0,
      verifier: { listPullRequests: assert.fail },
    },
  );
  runner.start();
  const initial = timers.shift();
  assert.ok(initial);
  assert.equal(initial.delay, 0);
  initial.callback();
  assert.equal(failures.at(-1)?.code, "io_execution_capacity_unavailable");
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, FORGEJO_POLL_INTERVAL_MS);
  runner.destroy();

  releases.splice(0).forEach((release) => release());
  await Promise.all([...active, ...queued, ioPool.close()]);
});
