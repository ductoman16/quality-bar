import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { runReviewRunCodex as runCodexAdapter } from "../src/review/review-run-codex-adapter.ts";
import { observeCodexProcess } from "../src/review/review-run-codex-process.ts";

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
    bindProcessGroup() {},
    async close() {},
    commandDirectory: "/submit-bin",
    environment: {
      QUALITY_BAR_SUBMIT_FILE: "/socket",
      QUALITY_BAR_SUBMIT_TOKEN: "secret",
    },
    failure: () => null,
    lastValidationFailure: () => null,
    submission: () => ({ prepared: true }),
    waitForResult: () => Promise.resolve("accepted" as "accepted"),
  };
}

export function runningProcess(pid: number) {
  return Object.assign(new EventEmitter(), {
    pid,
    stderr: new PassThrough(),
    stdout: new PassThrough(),
  });
}

function prepareDirectProcess(
  command: string,
  arguments_: string[],
  processOptions: { cwd: string; environment: NodeJS.ProcessEnv },
  nodeExecutable: string,
  spawnProcess:
    | ((
        command: string,
        arguments_: string[],
        options: import("node:child_process").SpawnOptions,
      ) => import("node:child_process").ChildProcess)
    | undefined,
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

export const runReviewRunCodex = (
  options: Omit<
    Parameters<typeof runCodexAdapter>[0],
    "finishProcessGroup" | "recordDeadline" | "startProcessGroup"
  > & {
    finishProcessGroup?: () => unknown;
    recordDeadline?: Parameters<typeof runCodexAdapter>[0]["recordDeadline"];
    startRun?: () => unknown;
    trackProcessGroup?: (processGroupId: number) => unknown;
  },
) =>
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
