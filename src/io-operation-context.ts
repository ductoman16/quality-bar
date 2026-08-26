import { AsyncLocalStorage } from "node:async_hooks";

const signals = new AsyncLocalStorage<AbortSignal>();
const TERMINATION_FAILURE_CODES = new Set([
  "git_termination_failed",
  "review_run_checkout_termination_failed",
]);

export function currentIoOperationSignal() {
  return signals.getStore();
}

function ioTerminationFailure(error: unknown) {
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
      TERMINATION_FAILURE_CODES.has(candidate.code as string)
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

export function isIoTerminationFailure(error: unknown) {
  return ioTerminationFailure(error) !== undefined;
}

export function throwIoTerminationFailure(
  error: unknown,
  cleanup?: () => void,
) {
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
        { code: (failure as { code: string }).code },
      );
    }
  }
  throw failure;
}

export function throwIfIoOperationAborted(error?: unknown) {
  throwIoTerminationFailure(error);
  currentIoOperationSignal()?.throwIfAborted();
}

export function runIoOperation(signal: AbortSignal, operation: () => unknown) {
  return signals.run(signal, operation);
}
