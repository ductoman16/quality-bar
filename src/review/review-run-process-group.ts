function isMissingProcess(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ESRCH";
}

function isPermissionDenied(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "EPERM";
}

function isClosedSupervisorIpc(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    ["EPIPE", "ERR_IPC_CHANNEL_CLOSED"].includes(String(error.code))
  );
}

export function createReviewRunProcessGroupTermination(
  options: Parameters<typeof terminateReviewRunProcessGroup>[0],
) {
  let termination: Promise<void> | undefined;
  return () => {
    termination ??= Promise.resolve().then(() =>
      terminateReviewRunProcessGroup(options),
    );
    return termination;
  };
}

export async function terminateReviewRunProcessGroup({
  child,
  processResult,
  killProcessGroup,
  setTerminationTimer,
  clearTerminationTimer,
  finishSupervisor = async () => {},
}: {
  child: import("node:child_process").ChildProcess;
  processResult: Promise<unknown>;
  killProcessGroup: (pid: number, signal: NodeJS.Signals | 0) => void;
  setTerminationTimer: (callback: () => void, milliseconds: number) => any;
  clearTerminationTimer: (timer: any) => void;
  finishSupervisor?: () => Promise<void>;
}) {
  if (!Number.isSafeInteger(child.pid) || (child.pid as number) < 1) {
    throw new TypeError("Codex Review Run process identity is unavailable");
  }
  const processGroupId = -(child.pid as number);
  try {
    killProcessGroup(processGroupId, "SIGTERM");
  } catch (error) {
    if (isMissingProcess(error)) {
      return;
    }
    throw error;
  }
  let terminationTimer: any;
  const forceKill = new Promise((resolve, reject) => {
    terminationTimer = setTerminationTimer(() => {
      try {
        killProcessGroup(processGroupId, "SIGKILL");
        resolve(undefined);
      } catch (error) {
        if (isMissingProcess(error)) {
          resolve(undefined);
        } else {
          reject(error);
        }
      }
    }, 5_000);
  });
  try {
    const first = await Promise.race([
      processResult.then(() => "process"),
      forceKill.then(() => "force-kill"),
    ]);
    if (first === "process") {
      try {
        await finishSupervisor();
      } catch (error) {
        if (!isClosedSupervisorIpc(error)) {
          throw error;
        }
      }
      try {
        killProcessGroup(processGroupId, 0);
      } catch (error) {
        if (isMissingProcess(error)) {
          return;
        }
        if (isPermissionDenied(error)) {
          await forceKill;
        }
        throw error;
      }
      await forceKill;
    }
  } finally {
    clearTerminationTimer(terminationTimer);
  }
}
