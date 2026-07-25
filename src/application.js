import { openDurableCore } from "./durable-core.js";
import {
  loadInstallationConfiguration,
  verifyInstallationKey,
} from "./installation-configuration.js";
import { createApplicationServer } from "./server.js";

const CODEX_TERMINATION_GRACE_MS = 5_000;

function structuredLog(writeLog, severity, event, component, outcome, error) {
  const record = {
    timestamp: new Date().toISOString(),
    severity,
    event,
    component,
    outcome,
  };
  if (error) {
    record.error = error.code;
    record.detail = error.message;
  }
  writeLog(`${JSON.stringify(record)}\n`);
}

function createHardStorageBoundary(writeLog) {
  const workers = new AbortController();
  const codexProcesses = new Set();
  let failure = null;

  function terminateCodexProcess(process) {
    if (process.exitCode !== null || process.signalCode !== null) {
      return;
    }
    process.kill("SIGTERM");
    const forceKill = setTimeout(() => {
      if (process.exitCode === null && process.signalCode === null) {
        process.kill("SIGKILL");
      }
    }, CODEX_TERMINATION_GRACE_MS);
    forceKill.unref();
    process.once("exit", () => clearTimeout(forceKill));
  }

  return {
    signal: workers.signal,
    get failure() {
      return failure;
    },
    enter(error) {
      if (failure) {
        return;
      }
      failure = error;
      workers.abort(error);
      for (const process of codexProcesses) {
        terminateCodexProcess(process);
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
    registerCodexProcess(process) {
      if (
        typeof process?.kill !== "function" ||
        typeof process?.once !== "function"
      ) {
        throw new TypeError("a running child process is required");
      }
      if (failure) {
        terminateCodexProcess(process);
        return;
      }
      codexProcesses.add(process);
      process.once("exit", () => codexProcesses.delete(process));
    },
  };
}

export function createApplication({
  databasePath,
  loadInstallation = loadInstallationConfiguration,
  writeLog = (line) => process.stderr.write(line),
}) {
  if (typeof databasePath !== "string" || databasePath.length === 0) {
    throw new TypeError("databasePath is required");
  }

  const storageBoundary = createHardStorageBoundary(writeLog);
  let durableCore = null;
  let startupFailure = null;

  try {
    const installation = loadInstallation();
    durableCore = openDurableCore(databasePath, {
      onStorageUnavailable(error) {
        storageBoundary.enter(error);
      },
    });
    verifyInstallationKey(durableCore, installation.masterKey);
    structuredLog(
      writeLog,
      "info",
      "installation_ready",
      "configuration",
      "success",
    );
  } catch (error) {
    durableCore?.close();
    durableCore = null;
    startupFailure = error;
    structuredLog(
      writeLog,
      "error",
      "installation_not_ready",
      "configuration",
      "failure",
      error,
    );
  }

  function readDurableCoreStatus() {
    const error = storageBoundary.failure ?? startupFailure;
    return error
      ? { error: error.code, status: "not_ready" }
      : { status: "ready" };
  }

  const server = createApplicationServer(readDurableCoreStatus);

  return {
    server,
    durableCore,
    workerSignal: storageBoundary.signal,
    registerCodexProcess(process) {
      storageBoundary.registerCodexProcess(process);
    },
    async close() {
      if (server.listening) {
        await new Promise((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        });
      }
      durableCore?.close();
    },
  };
}
