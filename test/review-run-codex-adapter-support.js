import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { runReviewRunCodex as runCodexAdapter } from "../src/review-run-codex-adapter.js";
import { observeCodexProcess } from "../src/review-run-codex-process.js";

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

/**
 * @param {string} command
 * @param {string[]} arguments_
 * @param {{cwd: string, environment: NodeJS.ProcessEnv}} processOptions
 * @param {string} nodeExecutable
 * @param {((command: string, arguments_: string[], options: import("node:child_process").SpawnOptions) => import("node:child_process").ChildProcess) | undefined} spawnProcess
 */
function prepareDirectProcess(
  command,
  arguments_,
  processOptions,
  nodeExecutable,
  spawnProcess,
) {
  if (
    typeof nodeExecutable !== "string" ||
    typeof spawnProcess !== "function"
  ) {
    throw new TypeError("Codex process spawn dependency is invalid");
  }
  return {
    async abort() {},
    child: spawnProcess(command, arguments_, {
      cwd: processOptions.cwd,
      detached: true,
      env: processOptions.environment,
      stdio: ["ignore", "pipe", "pipe"],
    }),
    async finish() {},
    async start() {},
  };
}

/** @param {Omit<Parameters<typeof runCodexAdapter>[0], "finishProcessGroup" | "recordDeadline" | "startProcessGroup"> & {finishProcessGroup?: () => unknown, recordDeadline?: Parameters<typeof runCodexAdapter>[0]["recordDeadline"], startRun?: () => unknown, trackProcessGroup?: (processGroupId: number) => unknown}} options */
export const runReviewRunCodex = (options) =>
  runCodexAdapter({
    ...options,
    finishProcessGroup: options.finishProcessGroup ?? (() => {}),
    observeProcess: options.observeProcess ?? observeCodexProcess,
    prepareProcess: options.prepareProcess ?? prepareDirectProcess,
    recordDeadline: options.recordDeadline ?? (() => {}),
    startProcessGroup(processGroupId) {
      options.startRun?.();
      options.trackProcessGroup?.(processGroupId);
    },
  });
