export class ApplicationShutdownError extends Error {
  name: "ApplicationShutdownError";
  code: "application_shutting_down";

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
  let failure: ApplicationShutdownError | null = null;

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
    guardStorageReserve<StorageReserve extends Record<string, any>>(
      storageReserve: StorageReserve,
    ): StorageReserve {
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
      return {
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
      } as StorageReserve;
    },
  };
}

export function installApplicationSignalHandlers(
  application: { close: () => unknown },
  {
    onFailure = () => {
      process.exitCode = 1;
    },
    processTarget = process,
  }: {
    onFailure?: (error: unknown) => unknown;
    processTarget?: Pick<
      NodeJS.Process,
      "once" | "removeListener" | "exitCode"
    >;
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

function codedShutdownFailure(error: unknown) {
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
  return error as Error & { code: string };
}

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
}: {
  codexRuntime: { close: () => Promise<unknown> } | null;
  durableCore: { close: () => unknown } | null;
  evaluations: { destroy?: () => unknown } | null;
  forgejoConnections: {
    destroy?: () => unknown;
    stopPolling?: () => unknown;
  } | null;
  githubConnections: {
    destroy?: () => unknown;
    stopPolling?: () => unknown;
  } | null;
  ioPool: {
    close: () => Promise<unknown>;
    drainCleanup: (reason: unknown) => unknown;
  };
  releaseInstallationLock: (() => unknown) | null;
  repositories: { destroy?: () => unknown } | null;
  server: import("fastify").FastifyInstance;
  shutdownBoundary: ReturnType<typeof createApplicationShutdownBoundary>;
  writeLog: ((line: string) => unknown) & { host: (line: string) => unknown };
}) {
  let closing: Promise<void> | null = null;
  return () => {
    if (closing) {
      return closing;
    }
    const shutdownFailure = shutdownBoundary.begin();
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
      let durableClosed = false;
      try {
        const codexDrain = codexRuntime?.close();
        const serverDrain = server.server.listening
          ? server.close()
          : Promise.resolve();
        githubConnections?.stopPolling?.();
        forgejoConnections?.stopPolling?.();
        ioPool.drainCleanup(shutdownFailure);
        await Promise.all([serverDrain, codexDrain]);
        await ioPool.close();
        evaluations?.destroy?.();
        repositories?.destroy?.();
        githubConnections?.destroy?.();
        forgejoConnections?.destroy?.();
        durableClosed = durableCore !== null;
        durableCore?.close();
        releaseInstallationLock?.();
        writeLog.host(
          `${JSON.stringify({
            timestamp: new Date().toISOString(),
            severity: "info",
            event: "application_shutdown_completed",
            component: "application",
            outcome: "success",
          })}\n`,
        );
      } catch (error) {
        const failure = codedShutdownFailure(error);
        (durableClosed ? writeLog.host : writeLog)(
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
