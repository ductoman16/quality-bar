/**
 * @param {import("node:child_process").ChildProcess} child
 * @param {() => {stderr: string, stdout: string}} readTranscript
 */
export function observeCodexProcess(child, readTranscript) {
  let closed = false;
  /** @type {Error | undefined} */
  let processError;
  /** @type {(error: Error) => void} */
  let signalProcessError;
  const error = new Promise((resolve) => {
    signalProcessError = resolve;
  });
  const result = new Promise((resolve) => {
    child.once("error", (failure) => {
      processError =
        failure instanceof Error
          ? failure
          : new TypeError("Codex Review Run process failed", {
              cause: failure,
            });
      signalProcessError(processError);
    });
    child.once("close", (code, signal) => {
      closed = true;
      resolve({
        code,
        error: processError,
        signal,
        ...readTranscript(),
      });
    });
  });
  return {
    error,
    result,
    wasClosed: () => closed,
  };
}
