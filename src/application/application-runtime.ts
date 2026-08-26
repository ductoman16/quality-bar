const CODEX_TERMINATION_GRACE_MS = 5_000;

export type CodedError = Error & { code: string };

export function structuredLog(
  writeLog: (line: string) => unknown,
  severity: string,
  event: string,
  component: string,
  outcome: string,
  error?: CodedError,
  correlation: {
    requestId?: string;
    repositoryId?: string;
    changesetId?: string;
    evaluationId?: string;
    reviewRunId?: string;
    waiverAdjudicationId?: string;
    deliverySourceId?: string;
  } = {},
) {
  const record = {
    timestamp: new Date().toISOString(),
    severity,
    event,
    component,
    outcome,
  } as {
    component: string;
    detail?: string;
    error?: string;
    event: string;
    outcome: string;
    severity: string;
    timestamp: string;
  };
  if (error) {
    record.error = error.code;
    record.detail = error.message;
  }
  Object.assign(record, {
    ...(correlation.requestId === undefined
      ? {}
      : { request_id: correlation.requestId }),
    ...(correlation.repositoryId === undefined
      ? {}
      : { repository_id: correlation.repositoryId }),
    ...(correlation.changesetId === undefined
      ? {}
      : { changeset_id: correlation.changesetId }),
    ...(correlation.evaluationId === undefined
      ? {}
      : { evaluation_id: correlation.evaluationId }),
    ...(correlation.reviewRunId === undefined
      ? {}
      : { review_run_id: correlation.reviewRunId }),
    ...(correlation.waiverAdjudicationId === undefined
      ? {}
      : { waiver_adjudication_id: correlation.waiverAdjudicationId }),
    ...(correlation.deliverySourceId === undefined
      ? {}
      : { delivery_source_id: correlation.deliverySourceId }),
  });
  writeLog(`${JSON.stringify(record)}\n`);
}

export function requireAvailableStorageReserve(
  storageBoundary: { assertAvailable: () => unknown },
  storageReserve: {
    assertCodexStartAvailable: () => unknown;
    assertWorkAdmissionAvailable: () => unknown;
    cleanupEligibleData: () => unknown;
  },
) {
  storageBoundary.assertAvailable();
  return storageReserve;
}

export function readCodexCapability(failure: CodedError | null) {
  return failure
    ? { error: failure.code, status: "unavailable" }
    : { status: "available" };
}

export function createWorkerSignal(
  storageBoundary: { signal: AbortSignal },
  shutdownBoundary: { signal: AbortSignal },
) {
  return AbortSignal.any([storageBoundary.signal, shutdownBoundary.signal]);
}

export function createDurableCoreStatusReader(
  storageBoundary: { failure: CodedError | null },
  executionRuntime: { failure: CodedError | null },
  shutdownBoundary: { failure: CodedError | null },
) {
  return () => {
    const error =
      storageBoundary.failure ??
      executionRuntime.failure ??
      shutdownBoundary.failure;
    return error
      ? { error: error.code, status: "not_ready" }
      : { status: "ready" };
  };
}

export function createHardStorageBoundary(
  writeLog: (line: string) => unknown,
  stopProductWork: (error: CodedError) => unknown,
) {
  if (typeof stopProductWork !== "function") {
    throw new TypeError("hard storage shutdown is required");
  }
  const workers = new AbortController();
  const codexProcesses = new Set(
    [] as {
      childProcess: import("node:child_process").ChildProcess;
      processGroup: boolean;
    }[],
  );
  let failure: CodedError | null = null;

  function processGroupAbsent(error: unknown) {
    return error instanceof Error && "code" in error && error.code === "ESRCH";
  }

  function reportTerminationFailure(cause: unknown) {
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

  function processActive({
    childProcess,
    processGroup,
  }: {
    childProcess: import("node:child_process").ChildProcess;
    processGroup: boolean;
  }) {
    if (!processGroup) {
      return childProcess.exitCode === null && childProcess.signalCode === null;
    }
    try {
      process.kill(-(childProcess.pid as number), 0);
      return true;
    } catch (error) {
      if (processGroupAbsent(error)) {
        return false;
      }
      throw error;
    }
  }

  function signalCodexProcess(
    {
      childProcess,
      processGroup,
    }: {
      childProcess: import("node:child_process").ChildProcess;
      processGroup: boolean;
    },
    signal: NodeJS.Signals,
  ) {
    if (processGroup) {
      process.kill(-(childProcess.pid as number), signal);
    } else {
      childProcess.kill(signal);
    }
  }

  function terminateCodexProcess(registered: {
    childProcess: import("node:child_process").ChildProcess;
    processGroup: boolean;
  }) {
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
    enter(error: CodedError) {
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
    registerCodexProcess(
      childProcess: import("node:child_process").ChildProcess,
      { processGroup = false }: { processGroup?: boolean } = {},
    ) {
      if (
        typeof childProcess?.kill !== "function" ||
        typeof childProcess?.once !== "function" ||
        typeof processGroup !== "boolean" ||
        (processGroup &&
          (!Number.isSafeInteger(childProcess.pid) ||
            (childProcess.pid as number) < 1))
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
