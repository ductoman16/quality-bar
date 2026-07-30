import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const SUPERVISOR_PATH = fileURLToPath(
  new URL("./codex-process-supervisor-child.mjs", import.meta.url),
);

/**
 * @param {string} command
 * @param {string[]} arguments_
 * @param {{cwd: string, environment: NodeJS.ProcessEnv}} options
 * @param {string} nodeExecutable
 * @param {(command: string, arguments_: string[], options: import("node:child_process").SpawnOptions) => import("node:child_process").ChildProcess} [spawnProcess]
 * @returns {{abort: () => Promise<void>, child: import("node:child_process").ChildProcess, finish: () => Promise<void>, start: () => Promise<void>}}
 */
export function prepareCodexProcess(
  command,
  arguments_,
  options,
  nodeExecutable,
  spawnProcess = spawn,
) {
  const child = spawnProcess(nodeExecutable, [SUPERVISOR_PATH], {
    cwd: options.cwd,
    detached: true,
    env: options.environment,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  function finish() {
    return new Promise((resolve, reject) => {
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
      return new Promise((resolve, reject) => {
        child.send(
          {
            arguments: arguments_,
            command,
            environment: options.environment,
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

/**
 * @param {import("node:child_process").ChildProcess} child
 * @param {() => {stderr: string, stdout: string}} readTranscript
 */
export function observeSupervisedCodexProcess(child, readTranscript) {
  let closed = false;
  /** @type {Error | undefined} */
  let processError;
  /** @type {(error: Error) => void} */
  let signalProcessError;
  /** @type {(result: unknown) => void} */
  let signalResult;
  const error = new Promise((resolve) => {
    signalProcessError = resolve;
  });
  const result = new Promise((resolve) => {
    signalResult = resolve;
  });
  /** @param {unknown} failure */
  function recordFailure(failure) {
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
    const report = /** @type {any} */ (message);
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
