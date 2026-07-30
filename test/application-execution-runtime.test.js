import assert from "node:assert/strict";
import test from "node:test";

import { createApplicationExecutionRuntime } from "../src/application-execution-runtime.js";
import {
  IO_EXECUTION_CONCURRENCY,
  IO_EXECUTION_QUEUE_CAPACITY,
  createIoDutyScheduler,
} from "../src/io-execution-pool.js";

test("the application observes exact recurring-duty saturation without skipping its durable owner", async () => {
  /** @type {any[]} */
  const logs = [];
  let stopped = 0;
  const runtime = createApplicationExecutionRuntime({
    createCodexRuntime: assert.fail,
    now: () => 0,
    stopIoDuties: () => {
      stopped += 1;
    },
    storageBoundary: /** @type {any} */ ({}),
    writeLog: (line) => logs.push(JSON.parse(line)),
  });
  /** @type {((value?: void) => void)[]} */
  const releases = [];
  const active = Array.from({ length: IO_EXECUTION_CONCURRENCY - 1 }, () =>
    runtime.ioPool.run(
      "acquisition",
      () => new Promise((resolve) => releases.push(resolve)),
    ),
  );
  await new Promise((resolve) => setImmediate(resolve));
  const queued = Array.from({ length: IO_EXECUTION_QUEUE_CAPACITY }, () =>
    runtime.ioPool.run("cleanup", () => {}),
  );
  createIoDutyScheduler(runtime.ioPool, "polling", assert.fail).background();
  assert.deepEqual(logs.at(-1), {
    timestamp: logs.at(-1).timestamp,
    severity: "warning",
    event: "io_duty_failed",
    component: "io",
    outcome: "failure",
    error: "io_execution_capacity_unavailable",
    detail: "I/O execution capacity is unavailable",
  });
  assert.equal(runtime.failure, null);
  assert.equal(stopped, 0);
  releases.splice(0).forEach((release) => release());
  await Promise.all([...active, ...queued, runtime.ioPool.close()]);
});

test("an unexpected recurring-duty failure becomes the exact hard runtime state", async () => {
  const failure = Object.assign(new Error("polling failed exactly"), {
    code: "github_poll_failed",
  });
  let stopped = 0;
  const runtime = createApplicationExecutionRuntime({
    createCodexRuntime: assert.fail,
    now: () => 0,
    stopIoDuties: () => {
      stopped += 1;
    },
    storageBoundary: /** @type {any} */ ({}),
    writeLog() {},
  });
  createIoDutyScheduler(runtime.ioPool, "polling", () => {
    throw failure;
  }).background();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runtime.failure, failure);
  assert.equal(stopped, 1);
  await runtime.ioPool.close();
});
