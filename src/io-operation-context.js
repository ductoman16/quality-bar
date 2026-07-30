import { AsyncLocalStorage } from "node:async_hooks";

const signals = new AsyncLocalStorage();
const TERMINATION_FAILURE_CODES = new Set([
  "git_termination_failed",
  "review_run_checkout_termination_failed",
]);

export function currentIoOperationSignal() {
  return signals.getStore();
}

/** @param {unknown} error */
function ioTerminationFailure(error) {
  const pending = [error];
  const visited = new Set();
  while (pending.length > 0) {
    const candidate = pending.pop();
    if (!(candidate instanceof Error) || visited.has(candidate)) {
      continue;
    }
    visited.add(candidate);
    if (
      "code" in candidate &&
      TERMINATION_FAILURE_CODES.has(/** @type {string} */ (candidate.code))
    ) {
      return candidate;
    }
    if (candidate instanceof AggregateError) {
      pending.push(...candidate.errors);
    }
    pending.push(candidate.cause);
  }
  return undefined;
}

/** @param {unknown} error */
export function isIoTerminationFailure(error) {
  return ioTerminationFailure(error) !== undefined;
}

/** @param {unknown} error @param {() => void} [cleanup] */
export function throwIoTerminationFailure(error, cleanup) {
  const failure = ioTerminationFailure(error);
  if (!failure) {
    return;
  }
  try {
    cleanup?.();
  } catch (cleanupCause) {
    if (failure instanceof AggregateError) {
      failure.errors.push(cleanupCause);
    } else {
      throw Object.assign(
        new AggregateError(
          [failure, cleanupCause],
          "I/O termination cleanup failed",
        ),
        { code: /** @type {{code: string}} */ (failure).code },
      );
    }
  }
  throw failure;
}

/** @param {unknown} [error] */
export function throwIfIoOperationAborted(error) {
  throwIoTerminationFailure(error);
  currentIoOperationSignal()?.throwIfAborted();
}

/**
 * @param {AbortSignal} signal
 * @param {() => unknown} operation
 */
export function runIoOperation(signal, operation) {
  return signals.run(signal, operation);
}
