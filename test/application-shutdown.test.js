import assert from "node:assert/strict";
import test from "node:test";

import {
  ApplicationShutdownError,
  createApplicationClose,
  createApplicationShutdownBoundary,
} from "../src/application/application-shutdown.js";
import { createIoExecutionPool } from "../src/io-execution-pool.js";
import { executeReviewRun } from "../src/review/review-run-execution.js";
import { evaluationFailureStatus } from "../src/evaluation/evaluation-route-failure.js";
import { isUnavailableError } from "../src/http-request.js";

test("graceful shutdown gates new durable work while preserving reads and cleanup", () => {
  /** @type {string[]} */
  const transitions = [];
  const shutdown = createApplicationShutdownBoundary();
  const storageReserve = shutdown.guardStorageReserve({
    assertCodexStartAvailable() {
      transitions.push("codex-start");
    },
    assertPollingObservationAdvanceAvailable() {
      transitions.push("polling-advance");
    },
    assertWorkAdmissionAvailable() {
      transitions.push("work-admission");
    },
    cleanupEligibleData() {
      transitions.push("cleanup");
      return { removed: 1 };
    },
    ioPool: { run() {} },
    preparePollingObservationAdvance() {
      transitions.push("polling-prepare");
    },
    readFacts() {
      transitions.push("read");
      return { status: "available" };
    },
  });

  storageReserve.assertWorkAdmissionAvailable();
  storageReserve.assertPollingObservationAdvanceAvailable();
  storageReserve.preparePollingObservationAdvance();
  storageReserve.assertCodexStartAvailable();
  assert.equal(shutdown.failure, null);

  const failure = shutdown.begin();

  assert.ok(failure instanceof ApplicationShutdownError);
  assert.equal(failure.code, "application_shutting_down");
  assert.equal(failure.message, "Quality Bar is shutting down");
  assert.equal(shutdown.failure, failure);
  assert.equal(shutdown.begin(), failure);
  for (const transition of [
    () => storageReserve.assertWorkAdmissionAvailable(),
    () => storageReserve.assertPollingObservationAdvanceAvailable(),
    () => storageReserve.preparePollingObservationAdvance(),
    () => storageReserve.assertCodexStartAvailable(),
  ]) {
    assert.throws(transition, (error) => error === failure);
  }
  assert.deepEqual(storageReserve.readFacts(), { status: "available" });
  assert.deepEqual(storageReserve.cleanupEligibleData(), { removed: 1 });
  assert.equal(storageReserve.ioPool.run instanceof Function, true);
  assert.deepEqual(transitions, [
    "work-admission",
    "polling-advance",
    "polling-prepare",
    "codex-start",
    "read",
    "cleanup",
  ]);
});

test("graceful shutdown aborts only its application-work signal", () => {
  const shutdown = createApplicationShutdownBoundary();
  assert.equal(shutdown.signal.aborted, false);

  const failure = shutdown.begin();

  assert.equal(shutdown.signal.aborted, true);
  assert.equal(shutdown.signal.reason, failure);
  assert.equal(isUnavailableError(failure), true);
  assert.equal(evaluationFailureStatus(failure), 503);
});

test("graceful close aborts bounded I/O and retains credentials until accepted work drains", async () => {
  /** @type {string[]} */
  const order = [];
  const codexDrain = /** @type {PromiseWithResolvers<void>} */ (
    Promise.withResolvers()
  );
  const ioDrain = /** @type {PromiseWithResolvers<void>} */ (
    Promise.withResolvers()
  );
  const shutdownBoundary = createApplicationShutdownBoundary();
  const close = createApplicationClose({
    codexRuntime: {
      close() {
        order.push("codex-drain");
        return codexDrain.promise;
      },
    },
    durableCore: { close: () => order.push("core-close") },
    evaluations: { destroy: () => order.push("evaluations-destroy") },
    forgejoConnections: {
      destroy: () => order.push("forgejo-destroy"),
      stopPolling: () => order.push("forgejo-stop-polling"),
    },
    githubConnections: {
      destroy: () => order.push("github-destroy"),
      stopPolling: () => order.push("github-stop-polling"),
    },
    ioPool: {
      close() {
        order.push("io-drain");
        return ioDrain.promise;
      },
      drainCleanup(error) {
        assert.equal(error, shutdownBoundary.failure);
        order.push("io-abort");
      },
    },
    releaseInstallationLock: () => order.push("lock-release"),
    repositories: { destroy: () => order.push("repositories-destroy") },
    server: /** @type {any} */ ({ server: { listening: false } }),
    shutdownBoundary,
    writeLog: Object.assign(() => order.push("durable-log"), {
      host: () => order.push("host-log"),
    }),
  });

  const closing = close();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, [
    "durable-log",
    "codex-drain",
    "github-stop-polling",
    "forgejo-stop-polling",
    "io-abort",
  ]);

  codexDrain.resolve(undefined);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(order.at(-1), "io-drain");
  ioDrain.resolve(undefined);
  await closing;
  assert.deepEqual(order.slice(6), [
    "evaluations-destroy",
    "repositories-destroy",
    "github-destroy",
    "forgejo-destroy",
    "core-close",
    "lock-release",
    "host-log",
  ]);
});

test("graceful close never reports completion when a finalizer fails", async () => {
  const failure = Object.assign(new Error("installation lock release failed"), {
    code: "installation_lock_release_failed",
  });
  /** @type {Record<string, any>[]} */
  const hostLogs = [];
  const close = createApplicationClose({
    codexRuntime: null,
    durableCore: { close() {} },
    evaluations: null,
    forgejoConnections: null,
    githubConnections: null,
    ioPool: { async close() {}, drainCleanup() {} },
    releaseInstallationLock() {
      throw failure;
    },
    repositories: null,
    server: /** @type {any} */ ({ server: { listening: false } }),
    shutdownBoundary: createApplicationShutdownBoundary(),
    writeLog: Object.assign(() => {}, {
      host: (/** @type {string} */ line) => hostLogs.push(JSON.parse(line)),
    }),
  });

  await assert.rejects(close(), (error) => error === failure);
  assert.equal(
    hostLogs.some(
      (record) => record.event === "application_shutdown_completed",
    ),
    false,
  );
  assert.equal(
    hostLogs.find((record) => record.event === "application_shutdown_failed")
      ?.error,
    "installation_lock_release_failed",
  );
});

test("a running Review Run completes required checkout cleanup during graceful drain", async () => {
  const ioPool = createIoExecutionPool();
  const started = Promise.withResolvers();
  const finish = Promise.withResolvers();
  let removed = 0;
  const execution = executeReviewRun(
    {
      all: () => [
        {
          criterion_id: "criterion-1",
          impact: "blocking",
          instruction: "Reject broken changes",
        },
      ],
      get: () => ({
        applicability_rule: null,
        base_commit: "a".repeat(40),
        execution_status: "queued",
        head_commit: "b".repeat(40),
        model: "gpt-5.3-codex",
        name: "Correctness",
        normalized_url: "https://example.test/repository.git",
        reasoning_effort: "high",
        service_tier: "priority",
      }),
    },
    { fencingToken: 7, workerId: "worker-1", workId: "run-1" },
    {
      claimService: {
        beginPreStartAttempt() {},
        startRenewal: () => () => {},
        startTracked() {},
      },
      ioPool,
      prepareCheckout: async () => ({
        path: "/checkout",
        remove() {
          removed += 1;
        },
      }),
      readFileChanges: () => [],
      resultService: { fail: assert.fail, prepare() {} },
      async runCodex(input) {
        input.startProcessGroup?.(4321);
        started.resolve(undefined);
        await finish.promise;
        return { diagnosticFailures: [] };
      },
    },
  );
  await started.promise;
  const shutdown = new ApplicationShutdownError();

  ioPool.drainCleanup(shutdown);
  finish.resolve(undefined);

  await execution;
  assert.equal(removed, 1);
  await ioPool.close();
});
