import assert from "node:assert/strict";
import test from "node:test";

import { createApplicationExecutionRuntime } from "../src/application/application-execution-runtime.js";
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
  createIoDutyScheduler(runtime.ioPool, "polling", () =>
    assert.fail("polling ran"),
  ).background();
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

test("the application registers a detached Codex supervisor as a process group", async () => {
  /** @type {any} */
  let codexDependencies;
  /** @type {any[]} */
  const registrations = [];
  const child = {
    exitCode: null,
    kill() {},
    once() {},
    pid: 123,
    signalCode: null,
  };
  const runtime = createApplicationExecutionRuntime({
    createCodexRuntime(durableCore, dependencies) {
      void durableCore;
      codexDependencies = dependencies;
      return {};
    },
    now: () => 0,
    spawnProcess: /** @type {any} */ (() => child),
    stopIoDuties() {},
    storageBoundary: /** @type {any} */ ({
      /** @param {any} childProcess @param {any} options */
      registerCodexProcess(childProcess, options) {
        registrations.push([childProcess, options]);
      },
    }),
    writeLog() {},
  });
  runtime.createCodexRuntime({}, {}, {});

  assert.equal(
    codexDependencies.spawnProcess("node", [], { detached: true }),
    child,
  );
  assert.deepEqual(registrations, [[child, { processGroup: true }]]);
  await runtime.ioPool.close();
});

test("a Codex execution failure keeps its owning resource correlation", async () => {
  const failure = Object.assign(new Error("Codex failed"), {
    code: "codex_failed",
  });
  /** @type {any[]} */
  const logs = [];
  /** @type {any} */
  let codexDependencies;
  const runtime = createApplicationExecutionRuntime({
    createCodexRuntime(durableCore, dependencies) {
      assert.equal(typeof durableCore.get, "function");
      codexDependencies = dependencies;
      return {};
    },
    now: () => 0,
    stopIoDuties() {},
    storageBoundary: /** @type {any} */ ({}),
    writeLog: (line) => logs.push(JSON.parse(line)),
  });
  runtime.createCodexRuntime(
    {
      get() {
        return {
          evaluation_id: "evaluation-1",
          repository_id: "repository-1",
        };
      },
    },
    {},
    {},
  );

  codexDependencies.reportFailure(failure, {
    workId: "review-run-1",
    workKind: "review_run",
  });

  assert.equal(logs[0].repository_id, "repository-1");
  assert.equal(logs[0].evaluation_id, "evaluation-1");
  assert.equal(logs[0].review_run_id, "review-run-1");
  assert.equal(logs[0].error, "codex_failed");
  await runtime.ioPool.close();
});

test("a Codex correlation lookup failure preserves the owning failure log", async () => {
  const failure = Object.assign(new Error("Codex failed exactly"), {
    code: "codex_failed",
  });
  /** @type {any[]} */
  const logs = [];
  /** @type {any} */
  let codexDependencies;
  const runtime = createApplicationExecutionRuntime({
    createCodexRuntime(durableCore, dependencies) {
      void durableCore;
      codexDependencies = dependencies;
      return {};
    },
    now: () => 0,
    stopIoDuties: assert.fail,
    storageBoundary: /** @type {any} */ ({}),
    writeLog: (line) => logs.push(JSON.parse(line)),
  });
  runtime.createCodexRuntime(
    {
      get() {
        throw new Error("correlation read failed");
      },
    },
    {},
    {},
  );

  codexDependencies.reportFailure(failure, {
    workId: "review-run-1",
    workKind: "review_run",
  });

  assert.equal(logs[0].review_run_id, "review-run-1");
  assert.equal(logs[0].error, "codex_failed");
  await runtime.ioPool.close();
});
