import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "node:test";

import {
  acceptedChannel,
  claim,
  run,
  runReviewRunCodex,
} from "./review-run-codex-adapter-support.js";

/** @param {number} code */
function processThatExits(code) {
  const child = new EventEmitter();
  const process = Object.assign(child, {
    pid: 76,
    stderr: new PassThrough(),
    stdout: new PassThrough(),
  });
  queueMicrotask(() => child.emit("close", code, null));
  return process;
}

/** @param {Error} processFailure */
function processThatReportsError(processFailure) {
  const child = new EventEmitter();
  const process = Object.assign(child, {
    pid: 79,
    stderr: new PassThrough(),
    stdout: new PassThrough(),
  });
  queueMicrotask(() => {
    child.emit("error", processFailure);
    queueMicrotask(() => child.emit("close", 1, null));
  });
  return process;
}

function committedChannel() {
  return {
    ...acceptedChannel(),
    accepted: () => false,
    hasCommittedSubmission: () => true,
    hasPendingSubmission: () => true,
    waitForResult: () =>
      Promise.resolve(/** @type {"accepted"} */ ("accepted")),
  };
}

/** @param {Error} failure */
function committedFailedChannel(failure) {
  return {
    ...acceptedChannel(),
    accepted: () => false,
    failure: () => failure,
    hasCommittedSubmission: () => true,
    hasPendingSubmission: () => true,
    waitForResult: () => Promise.resolve(/** @type {"failed"} */ ("failed")),
  };
}

test("a committed Result retains process termination failure as a diagnostic", async () => {
  const terminationFailure = new Error("process-group cleanup failed");
  const result = await runReviewRunCodex({
    checkoutPath: "/checkout",
    claim,
    killProcessGroup() {
      throw terminationFailure;
    },
    openSubmissionChannel: async () => committedChannel(),
    resultService: { prepare() {} },
    run,
    spawnProcess: () => /** @type {any} */ (processThatExits(0)),
  });
  assert.deepEqual(result, { diagnosticFailures: [terminationFailure] });
});

test("a committed Result retains process-error termination failure as a diagnostic", async () => {
  const processFailure = new Error("process transport failed");
  const terminationFailure = new Error("process-group cleanup failed");
  const result = await runReviewRunCodex({
    checkoutPath: "/checkout",
    claim,
    killProcessGroup() {
      throw terminationFailure;
    },
    openSubmissionChannel: async () => committedChannel(),
    resultService: { prepare() {} },
    run,
    spawnProcess: () =>
      /** @type {any} */ (processThatReportsError(processFailure)),
  });
  assert.deepEqual(result, { diagnosticFailures: [terminationFailure] });
});

test("a committed Result retains response-publication failure as a diagnostic", async () => {
  const publicationFailure = new Error("response publication failed");
  const result = await runReviewRunCodex({
    checkoutPath: "/checkout",
    claim,
    openSubmissionChannel: async () =>
      committedFailedChannel(publicationFailure),
    resultService: { prepare() {} },
    run,
    spawnProcess: () => /** @type {any} */ (processThatExits(0)),
  });
  assert.deepEqual(result, { diagnosticFailures: [publicationFailure] });
});
