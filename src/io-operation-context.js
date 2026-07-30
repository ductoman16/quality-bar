import { AsyncLocalStorage } from "node:async_hooks";

const signals = new AsyncLocalStorage();

export function currentIoOperationSignal() {
  return signals.getStore();
}

export function throwIfIoOperationAborted() {
  currentIoOperationSignal()?.throwIfAborted();
}

/**
 * @param {AbortSignal} signal
 * @param {() => unknown} operation
 */
export function runIoOperation(signal, operation) {
  return signals.run(signal, operation);
}
