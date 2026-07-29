import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { runReviewRunCodex as runCodexAdapter } from "../src/review-run-codex-adapter.js";

export const claim = Object.freeze({
  fencingToken: 7,
  workerId: "worker-1",
  workId: "run-1",
});

export const run = Object.freeze({
  configuration: {
    model: "gpt-5.6-terra",
    reasoning_effort: "high",
    service_tier: "fast",
  },
  criteria: [{ criterionId: "criterion-1" }],
  prompt: "Review the frozen Changeset",
});

export function acceptedChannel() {
  return {
    accepted: () => true,
    async close() {},
    commandDirectory: "/submit-bin",
    environment: {
      QUALITY_BAR_SUBMIT_SOCKET: "/socket",
      QUALITY_BAR_SUBMIT_TOKEN: "secret",
    },
    failure: () => null,
    lastValidationFailure: () => null,
    submission: () => ({ prepared: true }),
    waitForResult: () =>
      Promise.resolve(/** @type {"accepted"} */ ("accepted")),
  };
}

/** @param {number} pid */
export function runningProcess(pid) {
  return Object.assign(new EventEmitter(), {
    pid,
    stderr: new PassThrough(),
    stdout: new PassThrough(),
  });
}

/** @param {Omit<Parameters<typeof runCodexAdapter>[0], "startRun"> & {startRun?: () => unknown}} options */
export const runReviewRunCodex = (options) =>
  runCodexAdapter({ ...options, startRun: options.startRun ?? (() => {}) });
