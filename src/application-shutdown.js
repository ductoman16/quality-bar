export class ApplicationShutdownError extends Error {
  constructor() {
    super("Quality Bar is shutting down");
    this.name = "ApplicationShutdownError";
    this.code = "application_shutting_down";
  }
}

const GATED_STORAGE_TRANSITIONS = Object.freeze([
  "assertCodexStartAvailable",
  "assertPollingObservationAdvanceAvailable",
  "assertWorkAdmissionAvailable",
  "preparePollingObservationAdvance",
]);

export function createApplicationShutdownBoundary() {
  const workers = new AbortController();
  /** @type {ApplicationShutdownError | null} */
  let failure = null;

  function assertOpen() {
    if (failure) {
      throw failure;
    }
  }

  return {
    get failure() {
      return failure;
    },
    signal: workers.signal,
    begin() {
      if (failure) {
        return failure;
      }
      failure = new ApplicationShutdownError();
      workers.abort(failure);
      return failure;
    },
    /**
     * @template {Record<string, any>} StorageReserve
     * @param {StorageReserve} storageReserve
     * @returns {StorageReserve}
     */
    guardStorageReserve(storageReserve) {
      if (!storageReserve || typeof storageReserve !== "object") {
        throw new TypeError("Storage reserve shutdown boundary is required");
      }
      for (const transition of GATED_STORAGE_TRANSITIONS) {
        if (typeof storageReserve[transition] !== "function") {
          throw new TypeError(
            "Storage reserve shutdown transitions are incomplete",
          );
        }
      }
      return /** @type {StorageReserve} */ ({
        ...storageReserve,
        ...Object.fromEntries(
          GATED_STORAGE_TRANSITIONS.map((transition) => [
            transition,
            () => {
              assertOpen();
              return storageReserve[transition]();
            },
          ]),
        ),
      });
    },
  };
}

/**
 * @param {{close: () => unknown}} application
 * @param {{
 *   onFailure?: (error: unknown) => unknown,
 *   processTarget?: Pick<NodeJS.Process, "once" | "removeListener" | "exitCode">
 * }} [options]
 */
export function installApplicationSignalHandlers(
  application,
  {
    onFailure = () => {
      process.exitCode = 1;
    },
    processTarget = process,
  } = {},
) {
  if (
    typeof application?.close !== "function" ||
    typeof processTarget?.once !== "function" ||
    typeof processTarget?.removeListener !== "function" ||
    typeof onFailure !== "function"
  ) {
    throw new TypeError("Application signal shutdown dependencies are invalid");
  }
  let listening = true;
  const stopListening = () => {
    if (!listening) {
      return;
    }
    listening = false;
    processTarget.removeListener("SIGTERM", onSigterm);
    processTarget.removeListener("SIGINT", onSigint);
  };
  const begin = () => {
    stopListening();
    let completion;
    try {
      completion = application.close();
    } catch (error) {
      onFailure(error);
      return;
    }
    void Promise.resolve(completion).catch(onFailure);
  };
  const onSigterm = () => begin();
  const onSigint = () => begin();
  processTarget.once("SIGTERM", onSigterm);
  processTarget.once("SIGINT", onSigint);
  return stopListening;
}

/** @param {unknown} error */
function codedShutdownFailure(error) {
  if (!(error instanceof Error)) {
    return Object.assign(
      new TypeError("Application shutdown failed with a non-error", {
        cause: error,
      }),
      { code: "application_shutdown_failed" },
    );
  }
  if (!("code" in error) || typeof error.code !== "string") {
    Object.defineProperty(error, "code", {
      configurable: true,
      value: "application_shutdown_failed",
    });
  }
  return /** @type {Error & {code: string}} */ (error);
}

/**
 * @param {{
 *   codexRuntime: {close: () => Promise<unknown>} | null,
 *   durableCore: {close: () => unknown} | null,
 *   evaluations: {destroy?: () => unknown} | null,
 *   forgejoConnections: {destroy?: () => unknown} | null,
 *   githubConnections: {destroy?: () => unknown} | null,
 *   ioPool: {close: () => Promise<unknown>},
 *   releaseInstallationLock: (() => unknown) | null,
 *   repositories: {destroy?: () => unknown} | null,
 *   server: import("node:http").Server,
 *   shutdownBoundary: ReturnType<typeof createApplicationShutdownBoundary>,
 *   writeLog: (line: string) => unknown,
 * }} dependencies
 */
export function createApplicationClose({
  codexRuntime,
  durableCore,
  evaluations,
  forgejoConnections,
  githubConnections,
  ioPool,
  releaseInstallationLock,
  repositories,
  server,
  shutdownBoundary,
  writeLog,
}) {
  /** @type {Promise<void> | null} */
  let closing = null;
  return () => {
    if (closing) {
      return closing;
    }
    shutdownBoundary.begin();
    writeLog(
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        severity: "info",
        event: "application_shutdown_started",
        component: "application",
        outcome: "started",
      })}\n`,
    );
    closing = (async () => {
      try {
        const codexDrain = codexRuntime?.close();
        const serverDrain = server.listening
          ? /** @type {Promise<void>} */ (
              new Promise((resolve, reject) => {
                server.close((error) => (error ? reject(error) : resolve()));
              })
            )
          : Promise.resolve();
        githubConnections?.destroy?.();
        forgejoConnections?.destroy?.();
        await Promise.all([serverDrain, codexDrain]);
        await ioPool.close();
        evaluations?.destroy?.();
        repositories?.destroy?.();
        writeLog(
          `${JSON.stringify({
            timestamp: new Date().toISOString(),
            severity: "info",
            event: "application_shutdown_completed",
            component: "application",
            outcome: "success",
          })}\n`,
        );
        durableCore?.close();
        releaseInstallationLock?.();
      } catch (error) {
        const failure = codedShutdownFailure(error);
        writeLog(
          `${JSON.stringify({
            timestamp: new Date().toISOString(),
            severity: "error",
            event: "application_shutdown_failed",
            component: "application",
            outcome: "failure",
            error: failure.code,
            detail: failure.message,
          })}\n`,
        );
        throw failure;
      }
    })();
    return closing;
  };
}
