import assert from "node:assert/strict";
import test from "node:test";

import {
  ApplicationShutdownError,
  createApplicationClose,
  createApplicationShutdownBoundary,
} from "../src/application-shutdown.js";
import { evaluationFailureStatus } from "../src/evaluation-route-failure.js";
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
      shutdown(error) {
        assert.equal(error, shutdownBoundary.failure);
        order.push("io-abort");
      },
    },
    releaseInstallationLock: () => order.push("lock-release"),
    repositories: { destroy: () => order.push("repositories-destroy") },
    server: /** @type {any} */ ({ listening: false }),
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
    "io-drain",
  ]);

  ioDrain.resolve(undefined);
  codexDrain.resolve(undefined);
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
    ioPool: { async close() {}, shutdown() {} },
    releaseInstallationLock() {
      throw failure;
    },
    repositories: null,
    server: /** @type {any} */ ({ listening: false }),
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
