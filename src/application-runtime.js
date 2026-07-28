const CODEX_TERMINATION_GRACE_MS = 5_000;

/** @typedef {Error & {code: string}} CodedError */

/**
 * @param {(line: string) => unknown} writeLog
 * @param {string} severity
 * @param {string} event
 * @param {string} component
 * @param {string} outcome
 * @param {CodedError} [error]
 */
export function structuredLog(
  writeLog,
  severity,
  event,
  component,
  outcome,
  error,
) {
  const record = /** @type {{
   *   component: string,
   *   detail?: string,
   *   error?: string,
   *   event: string,
   *   outcome: string,
   *   severity: string,
   *   timestamp: string
   * }} */ ({
    timestamp: new Date().toISOString(),
    severity,
    event,
    component,
    outcome,
  });
  if (error) {
    record.error = error.code;
    record.detail = error.message;
  }
  writeLog(`${JSON.stringify(record)}\n`);
}

/** @param {(line: string) => unknown} writeLog */
export function createHardStorageBoundary(writeLog) {
  const workers = new AbortController();
  const codexProcesses = new Set(
    /** @type {import("node:child_process").ChildProcess[]} */ ([]),
  );
  /** @type {CodedError | null} */
  let failure = null;

  /** @param {import("node:child_process").ChildProcess} childProcess */
  function terminateCodexProcess(childProcess) {
    if (childProcess.exitCode !== null || childProcess.signalCode !== null) {
      return;
    }
    childProcess.kill("SIGTERM");
    const forceKill = setTimeout(() => {
      if (childProcess.exitCode === null && childProcess.signalCode === null) {
        childProcess.kill("SIGKILL");
      }
    }, CODEX_TERMINATION_GRACE_MS);
    forceKill.unref();
    childProcess.once("exit", () => clearTimeout(forceKill));
  }

  return {
    signal: workers.signal,
    get failure() {
      return failure;
    },
    /** @param {CodedError} error */
    enter(error) {
      if (failure) {
        return;
      }
      failure = error;
      workers.abort(error);
      for (const childProcess of codexProcesses) {
        terminateCodexProcess(childProcess);
      }
      structuredLog(
        writeLog,
        "error",
        "storage_unavailable",
        "storage",
        "failure",
        error,
      );
    },
    /** @param {import("node:child_process").ChildProcess} childProcess */
    registerCodexProcess(childProcess) {
      if (
        typeof childProcess?.kill !== "function" ||
        typeof childProcess?.once !== "function"
      ) {
        throw new TypeError("a running child process is required");
      }
      if (failure) {
        terminateCodexProcess(childProcess);
        return;
      }
      codexProcesses.add(childProcess);
      childProcess.once("exit", () => codexProcesses.delete(childProcess));
    },
  };
}
