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

/**
 * @param {(line: string) => unknown} writeLog
 * @param {(error: CodedError) => unknown} stopProductWork
 */
export function createHardStorageBoundary(writeLog, stopProductWork) {
  if (typeof stopProductWork !== "function") {
    throw new TypeError("hard storage shutdown is required");
  }
  const workers = new AbortController();
  const codexProcesses = new Set(
    /** @type {{childProcess: import("node:child_process").ChildProcess, processGroup: boolean}[]} */ ([]),
  );
  /** @type {CodedError | null} */
  let failure = null;

  /** @param {unknown} error */
  function processGroupAbsent(error) {
    return error instanceof Error && "code" in error && error.code === "ESRCH";
  }

  /** @param {unknown} cause */
  function reportTerminationFailure(cause) {
    structuredLog(
      writeLog,
      "error",
      "codex_termination_failed",
      "codex",
      "failure",
      Object.assign(new Error("Codex process termination failed", { cause }), {
        code: "codex_termination_failed",
      }),
    );
  }

  /** @param {{childProcess: import("node:child_process").ChildProcess, processGroup: boolean}} registered */
  function processActive({ childProcess, processGroup }) {
    if (!processGroup) {
      return childProcess.exitCode === null && childProcess.signalCode === null;
    }
    try {
      process.kill(-(/** @type {number} */ (childProcess.pid)), 0);
      return true;
    } catch (error) {
      if (processGroupAbsent(error)) {
        return false;
      }
      throw error;
    }
  }

  /**
   * @param {{childProcess: import("node:child_process").ChildProcess, processGroup: boolean}} registered
   * @param {NodeJS.Signals} signal
   */
  function signalCodexProcess({ childProcess, processGroup }, signal) {
    if (processGroup) {
      process.kill(-(/** @type {number} */ (childProcess.pid)), signal);
    } else {
      childProcess.kill(signal);
    }
  }

  /** @param {{childProcess: import("node:child_process").ChildProcess, processGroup: boolean}} registered */
  function terminateCodexProcess(registered) {
    try {
      if (!processActive(registered)) {
        return;
      }
      signalCodexProcess(registered, "SIGTERM");
    } catch (error) {
      if (processGroupAbsent(error)) {
        return;
      }
      reportTerminationFailure(error);
    }
    const forceKill = setTimeout(() => {
      try {
        if (processActive(registered)) {
          signalCodexProcess(registered, "SIGKILL");
        }
      } catch (error) {
        if (!processGroupAbsent(error)) {
          reportTerminationFailure(error);
        }
      }
    }, CODEX_TERMINATION_GRACE_MS);
    forceKill.unref();
    registered.childProcess.once("exit", () => {
      try {
        if (!processActive(registered)) {
          clearTimeout(forceKill);
        }
      } catch (error) {
        reportTerminationFailure(error);
      }
    });
  }

  return {
    signal: workers.signal,
    get failure() {
      return failure;
    },
    assertAvailable() {
      if (failure) {
        throw failure;
      }
    },
    /** @param {CodedError} error */
    enter(error) {
      if (failure) {
        return;
      }
      failure = error;
      workers.abort(error);
      for (const registered of codexProcesses) {
        terminateCodexProcess(registered);
      }
      stopProductWork(error);
      structuredLog(
        writeLog,
        "error",
        "storage_unavailable",
        "storage",
        "failure",
        error,
      );
    },
    /**
     * @param {import("node:child_process").ChildProcess} childProcess
     * @param {{processGroup?: boolean}} [options]
     */
    registerCodexProcess(childProcess, { processGroup = false } = {}) {
      if (
        typeof childProcess?.kill !== "function" ||
        typeof childProcess?.once !== "function" ||
        typeof processGroup !== "boolean" ||
        (processGroup &&
          (!Number.isSafeInteger(childProcess.pid) ||
            /** @type {number} */ (childProcess.pid) < 1))
      ) {
        throw new TypeError("a running child process is required");
      }
      const registered = { childProcess, processGroup };
      if (failure) {
        terminateCodexProcess(registered);
        return;
      }
      codexProcesses.add(registered);
      childProcess.once("exit", () => codexProcesses.delete(registered));
    },
  };
}
