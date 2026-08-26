import assert from "node:assert/strict";
import test from "node:test";

import { createForgejoPollingRunner } from "../src/forgejo/forgejo-polling-runner.ts";
import {
  IO_EXECUTION_CONCURRENCY,
  IO_EXECUTION_QUEUE_CAPACITY,
  createIoExecutionPool,
} from "../src/io-execution-pool.ts";
import { createIoDutyTimer } from "../src/io-duty-timer.ts";
import { FORGEJO_POLL_INTERVAL_MS } from "../src/forgejo/forgejo-polling.ts";

test("a stopped I/O duty cannot restart from an earlier lifecycle callback", () => {
  const timers: { callback: () => void; unref: () => void }[] = [];
  const cleared: any[] = [];
  let backgroundRuns = 0;
  const dutyTimer = createIoDutyTimer(
    Object.assign(() => {}, {
      background() {
        backgroundRuns += 1;
        return true;
      },
    }),
    {
      clearTimer: (timer) => cleared.push(timer),
      retryDelay: 10,
      setTimer(callback) {
        const timer = { callback, unref() {} };
        timers.push(timer);
        return timer;
      },
    },
  );

  dutyTimer.start(0);
  const staleTimer = timers[0];
  dutyTimer.stop();
  dutyTimer.start(0);
  const restartTimer = timers[1];
  dutyTimer.stop();
  staleTimer.callback();
  restartTimer.callback();

  assert.deepEqual(cleared, [staleTimer, restartTimer]);
  assert.equal(backgroundRuns, 0);
  assert.equal(timers.length, 2);
});

test("the actual Forgejo one-shot scheduler remains due after I/O saturation", async () => {
  const failures: any[] = [];
  const ioPool = createIoExecutionPool({
    reportBackgroundFailure: (error) => failures.push(error),
  });
  const releases: ((value?: void) => void)[] = [];
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
  const timers: { callback: () => void; delay: number; unref: () => void }[] =
    [];
  const runner = createForgejoPollingRunner(
    {
      all: () => [],
      transaction: (callback: (transaction: any) => unknown) =>
        callback({
          all: () => [],
          get: () => undefined,
          run: () => ({ changes: 0 }),
        }),
    },
    {
      acquirePullRequestChangeset: assert.fail,
      admitAutomaticEvaluation: assert.fail,
      cipher: { decrypt: assert.fail },
      setTimer(callback: () => void, delay: number) {
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
