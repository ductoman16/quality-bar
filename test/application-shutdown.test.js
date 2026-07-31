import assert from "node:assert/strict";
import test from "node:test";

import {
  ApplicationShutdownError,
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
