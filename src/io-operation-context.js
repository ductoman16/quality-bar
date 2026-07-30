import { AsyncLocalStorage } from "node:async_hooks";

const signals = new AsyncLocalStorage();

export function currentIoOperationSignal() {
  return signals.getStore();
}

/** @param {unknown} error */
export function isIoTerminationFailure(error) {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "git_termination_failed" ||
      error.code === "review_run_checkout_termination_failed")
  );
}

/** @param {unknown} error @param {() => void} [cleanup] */
export function throwIoTerminationFailure(error, cleanup) {
  if (!isIoTerminationFailure(error)) {
    return;
  }
  try {
    cleanup?.();
  } catch (cleanupCause) {
    if (error instanceof AggregateError) {
      error.errors.push(cleanupCause);
    }
  }
  throw error;
}

/** @param {unknown} [error] */
export function throwIfIoOperationAborted(error) {
  if (!isIoTerminationFailure(error)) {
    currentIoOperationSignal()?.throwIfAborted();
  }
}

/**
 * @param {AbortSignal} signal
 * @param {() => unknown} operation
 */
export function runIoOperation(signal, operation) {
  return signals.run(signal, operation);
}
