import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const SUPERVISOR_PATH = fileURLToPath(
  new URL("./codex-process-supervisor-child.mts", import.meta.url),
);

export function prepareCodexProcess(
  command: string,
  arguments_: string[],
  options: {
    cwd: string;
    environment: NodeJS.ProcessEnv;
    terminateOnParentDisconnect?: boolean;
  },
  nodeExecutable: string,
  spawnProcess: (
    command: string,
    arguments_: string[],
    options: import("node:child_process").SpawnOptions,
  ) => import("node:child_process").ChildProcess = spawn,
): {
  abort: () => Promise<void>;
  child: import("node:child_process").ChildProcess;
  finish: () => Promise<void>;
  start: () => Promise<void>;
} {
  const child = spawnProcess(nodeExecutable, [SUPERVISOR_PATH], {
    cwd: options.cwd,
    detached: true,
    env: options.environment,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  function finish() {
    return new Promise<void>((resolve, reject) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve(undefined);
        return;
      }
      child.once("close", () => resolve(undefined));
      child.send({ type: "finish" }, (error) => {
        if (error) {
          reject(error);
        }
      });
    });
  }
  return {
    abort: finish,
    child,
    finish,
    start() {
      return new Promise<void>((resolve, reject) => {
        child.send(
          {
            arguments: arguments_,
            command,
            environment: options.environment,
            terminateOnParentDisconnect:
              options.terminateOnParentDisconnect === true,
            type: "launch",
          },
          (error) => {
            if (error) {
              reject(error);
            } else {
              resolve(undefined);
            }
          },
        );
      });
    },
  };
}

export function observeSupervisedCodexProcess(
  child: import("node:child_process").ChildProcess,
  readTranscript: () => { stderr: string; stdout: string },
) {
  let closed = false;
  let processError: Error | undefined;
  let signalProcessError: (error: Error) => void;
  let signalResult: (result: unknown) => void;
  const error = new Promise((resolve) => {
    signalProcessError = resolve;
  });
  const result = new Promise((resolve) => {
    signalResult = resolve;
  });
  function recordFailure(failure: unknown) {
    if (processError) {
      return;
    }
    processError =
      failure instanceof Error
        ? failure
        : new TypeError("Codex Review Run process failed", { cause: failure });
    signalProcessError(processError);
  }
  child.once("error", recordFailure);
  child.on("message", (message) => {
    const report = message as any;
    if (report?.type === "launch-error") {
      recordFailure(
        new TypeError(
          typeof report.message === "string"
            ? report.message
            : "Codex Review Run process could not start",
        ),
      );
      closed = true;
      signalResult({
        code: null,
        error: processError,
        signal: null,
        ...readTranscript(),
      });
    } else if (report?.type === "result" && !closed) {
      closed = true;
      signalResult({
        code: report.code,
        error: processError,
        signal: report.signal,
        ...readTranscript(),
      });
    }
  });
  child.once("close", (code, signal) => {
    if (closed) {
      return;
    }
    closed = true;
    recordFailure(
      new TypeError(
        "Codex process supervisor exited before reporting a result",
      ),
    );
    signalResult({
      code,
      error: processError,
      signal,
      ...readTranscript(),
    });
  });
  return { error, result, wasClosed: () => closed };
}
