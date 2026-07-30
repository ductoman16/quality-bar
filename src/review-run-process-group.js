/** @param {unknown} error */
function isMissingProcess(error) {
  return error instanceof Error && "code" in error && error.code === "ESRCH";
}

/** @param {unknown} error */
function isPermissionDenied(error) {
  return error instanceof Error && "code" in error && error.code === "EPERM";
}

/** @param {Parameters<typeof terminateReviewRunProcessGroup>[0]} options */
export function createReviewRunProcessGroupTermination(options) {
  /** @type {Promise<void> | undefined} */
  let termination;
  return () => {
    termination ??= Promise.resolve().then(() =>
      terminateReviewRunProcessGroup(options),
    );
    return termination;
  };
}

/**
 * @param {{
 *   child: import("node:child_process").ChildProcess,
 *   processResult: Promise<unknown>,
 *   killProcessGroup: (pid: number, signal: NodeJS.Signals | 0) => void,
 *   setTerminationTimer: (callback: () => void, milliseconds: number) => any,
 *   clearTerminationTimer: (timer: any) => void
 *   finishSupervisor?: () => Promise<void>
 * }} options
 */
export async function terminateReviewRunProcessGroup({
  child,
  processResult,
  killProcessGroup,
  setTerminationTimer,
  clearTerminationTimer,
  finishSupervisor = async () => {},
}) {
  if (
    !Number.isSafeInteger(child.pid) ||
    /** @type {number} */ (child.pid) < 1
  ) {
    throw new TypeError("Codex Review Run process identity is unavailable");
  }
  const processGroupId = -(/** @type {number} */ (child.pid));
  try {
    killProcessGroup(processGroupId, "SIGTERM");
  } catch (error) {
    if (isMissingProcess(error)) {
      return;
    }
    throw error;
  }
  /** @type {any} */
  let terminationTimer;
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
      await finishSupervisor();
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
